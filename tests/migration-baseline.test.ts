import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(import.meta.dirname, '..', 'drizzle');

describe('public database baseline', () => {
  it('contains one non-destructive initial migration', () => {
    const migrations = readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql'));
    expect(migrations).toHaveLength(1);

    const sql = readFileSync(join(migrationDirectory, migrations[0]), 'utf8');
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|DATABASE)\b/i);
  });

  it('stores provider credentials only in the encrypted column', () => {
    const [migration] = readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql'));
    const sql = readFileSync(join(migrationDirectory, migration), 'utf8');
    expect(sql).toContain('`api_key_ciphertext`');
    expect(sql).not.toMatch(/`api_key`\s+text/i);
  });
});
