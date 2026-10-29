import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The "Deploy to Cloudflare" button reads these files from the repository as
// they are. A mistake here does not fail any build in this repository; it
// fails, or quietly weakens, every copy someone deploys.

const root = join(import.meta.dirname, '..');
const read = (file: string) => readFileSync(join(root, file), 'utf8');

type Wrangler = {
  d1_databases: Array<{ binding: string; database_id?: string; migrations_dir?: string }>;
  r2_buckets: Array<{ binding: string }>;
};

// wrangler.jsonc uses only whole-line comments.
const wrangler = JSON.parse(read('wrangler.jsonc').split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')) as Wrangler;

describe('Cloudflare deployment configuration', () => {
  it('declares the bindings the app reads, without account-specific IDs', () => {
    // Without an ID, Cloudflare creates the resource on the deployer's own
    // account. A committed ID would point every copy at one database.
    expect(wrangler.d1_databases).toEqual([expect.objectContaining({ binding: 'DB', migrations_dir: 'drizzle' })]);
    expect(wrangler.d1_databases[0].database_id).toBeUndefined();
    expect(wrangler.r2_buckets).toEqual([expect.objectContaining({ binding: 'FILES' })]);
  });

  it('applies migrations by binding name before the new version goes live', () => {
    // The binding name keeps working when the deployer renames the database.
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['db:migrate']).toBe('wrangler d1 migrations apply DB --remote');
    expect(scripts.deploy.indexOf('db:migrate')).toBeLessThan(scripts.deploy.indexOf('wrangler deploy'));
  });

  it('never offers a placeholder secret that would pass the 32-character check', () => {
    // The button pre-fills these values. A long placeholder would deploy a
    // working setup key that anyone can read in this repository.
    const prompted = read('.dev.vars.example')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('='));
    expect(prompted.map(([key]) => key)).toEqual(['OWNER_SETUP_TOKEN', 'PROVIDER_KEY_ENCRYPTION_KEY']);
    for (const [key, value] of prompted) expect(value.length, key).toBeLessThan(32);
  });
});
