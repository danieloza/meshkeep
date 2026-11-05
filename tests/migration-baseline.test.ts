import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationDirectory = join(import.meta.dirname, '..', 'drizzle');
const migrations = readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql')).sort();
const read = (name: string) => readFileSync(join(migrationDirectory, name), 'utf8');

// SQLite cannot change a table's primary key in place. The only way is to
// rebuild it: create `__new_x`, copy every row of `x` into it, drop `x` and
// rename `__new_x` to `x`. That drops a table without losing a row, so it is
// the one DROP TABLE allowed here, and only in that exact shape.
function isRebuild(sql: string, table: string): boolean {
  const copy = new RegExp(`INSERT INTO \`__new_${table}\`[\\s\\S]*?FROM \`${table}\`\\s*;`, 'i').exec(sql);
  const renamed = new RegExp(`ALTER TABLE \`__new_${table}\` RENAME TO \`${table}\``, 'i').test(sql);
  // A WHERE in the copy would leave rows behind.
  return Boolean(copy) && !/\bWHERE\b/i.test(copy![0]) && renamed;
}

describe('public database baseline', () => {
  it('starts from one initial migration and never deletes data', () => {
    expect(migrations[0]).toMatch(/^0000_/);
    // The private deployment once needed a one-time cleanup migration. The
    // public history must never carry anything like it: every step may add
    // tables and columns, or rebuild a table with all its rows, but none may
    // remove data.
    for (const name of migrations) {
      const sql = read(name);
      expect(sql, name).not.toMatch(/\bDELETE\s+FROM\b/i);
      expect(sql, name).not.toMatch(/\bDROP\s+(DATABASE|COLUMN)\b/i);
      for (const [, table] of sql.matchAll(/\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?/gi)) {
        expect(isRebuild(sql, table), `${name} drops ${table} without copying every row first`).toBe(true);
      }
    }
  });

  it('allows a rebuild only when every row is copied', () => {
    const rebuild = 'INSERT INTO `__new_t` ("id") SELECT "id" FROM `t`;\nDROP TABLE `t`;\nALTER TABLE `__new_t` RENAME TO `t`;';
    expect(isRebuild(rebuild, 't')).toBe(true);
    expect(isRebuild(rebuild.replace('FROM `t`;', 'FROM `t` WHERE "id" > 5;'), 't')).toBe(false);
    expect(isRebuild('DROP TABLE `t`;', 't')).toBe(false);
  });

  it('stores provider credentials only in the encrypted column', () => {
    const sql = migrations.map(read).join('\n');
    expect(sql).toContain('`api_key_ciphertext`');
    expect(sql).not.toMatch(/`api_key`\s+text/i);
  });
});
