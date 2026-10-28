import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(import.meta.dirname, '..', 'drizzle');
const migrations = readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql')).sort();
const read = (name: string) => readFileSync(join(migrationDirectory, name), 'utf8');

describe('public database baseline', () => {
  it('starts from one initial migration and only ever adds to it', () => {
    expect(migrations[0]).toMatch(/^0000_/);
    // The private deployment once needed a one-time cleanup migration. The
    // public history must never carry anything like it: every step may add
    // tables and columns, but none may remove data.
    for (const name of migrations) {
      const sql = read(name);
      expect(sql, name).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(sql, name).not.toMatch(/\bDROP\s+(TABLE|DATABASE|COLUMN)\b/i);
    }
  });

  it('stores provider credentials only in the encrypted column', () => {
    const sql = migrations.map(read).join('\n');
    expect(sql).toContain('`api_key_ciphertext`');
    expect(sql).not.toMatch(/`api_key`\s+text/i);
  });
});
