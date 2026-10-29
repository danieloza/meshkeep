import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

// Workers Builds sets WORKERS_CI=1, which covers the "Deploy to Cloudflare"
// button and every later push; MESHKEEP_TARGET=cloudflare does the same for a
// deploy from a laptop. Those builds use wrangler.jsonc as it is, so
// Cloudflare creates and links real resources. Every other build (OpenAI
// Sites, local development, the test suite) keeps the Sites placeholders.
const cloudflareTarget = process.env.WORKERS_CI === '1' || process.env.MESHKEEP_TARGET === 'cloudflare';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        // Assigned rather than merged, so the bindings from wrangler.jsonc are
        // replaced outright instead of appearing next to the placeholders.
        config: cloudflareTarget
          ? undefined
          : (worker) => {
              worker.main = localBindingConfig.main;
              worker.compatibility_flags = localBindingConfig.compatibility_flags;
              worker.d1_databases = localBindingConfig.d1_databases;
              worker.r2_buckets = localBindingConfig.r2_buckets;
            },
      }),
    ],
  };
});
