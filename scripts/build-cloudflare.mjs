// Builds for a deployment on your own Cloudflare account, from any shell.
//
//   npm run build:cloudflare
//
// The same as `MESHKEEP_TARGET=cloudflare npm run build`, which PowerShell and
// cmd cannot express inline. Workers Builds does not need this: it sets
// WORKERS_CI=1, which vite.config.ts treats the same way.

import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['vinext', 'build'], {
  stdio: 'inherit',
  // npx is a .cmd shim on Windows and only resolves through a shell there.
  shell: process.platform === 'win32',
  env: { ...process.env, MESHKEEP_TARGET: 'cloudflare' },
});
process.exit(result.status ?? 1);
