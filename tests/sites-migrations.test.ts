import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { buildMatchQuery } from '@/lib/search';
import { PUBLIC_HEAD, SITES_PREFIX, sitesMigrationLine, writeSitesMigrationLine } from '@/scripts/sites-migrations.mjs';

const PUBLIC_DIR = join(__dirname, '..', 'drizzle');
const PREFIX_DIR = join(__dirname, '..', 'deploy', 'sites', 'migrations');

const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

function tempCopy(dir: string) {
  const copy = mkdtempSync(join(tmpdir(), 'meshkeep-migrations-'));
  scratch.push(copy);
  cpSync(dir, copy, { recursive: true });
  return copy;
}

const journalOf = (dir: string) => join(dir, 'meta', '_journal.json');

// A migration added later in `drizzle/`, numbered and recorded the way
// drizzle-kit does it. Returns its tag.
function addPublicMigration(dir: string, name: string, sql: string, when = Date.now()) {
  const journal = JSON.parse(readFileSync(journalOf(dir), 'utf8'));
  const tag = `${String(journal.entries.length).padStart(4, '0')}_${name}`;
  writeFileSync(join(dir, `${tag}.sql`), sql);
  journal.entries.push({ idx: journal.entries.length, version: '6', when, tag, breakpoints: true });
  writeFileSync(journalOf(dir), JSON.stringify(journal, null, 2));
  return tag;
}

describe('Sites migration line', () => {
  it('is the frozen prefix followed by the public migrations from 0006 on', () => {
    const line = sitesMigrationLine();
    const publicTags = readdirSync(PUBLIC_DIR).filter((name) => name.endsWith('.sql')).sort().map((name) => name.slice(0, -'.sql'.length));
    expect(line.migrations.map((m) => m.tag)).toEqual([...Object.keys(SITES_PREFIX), ...publicTags.slice(PUBLIC_HEAD.length)]);
    expect(line.journal.entries.map((entry: { tag: string }) => entry.tag)).toEqual(line.migrations.map((m) => m.tag));
  });

  it('carries a new public migration over unchanged and under the same name', () => {
    const publicDir = tempCopy(PUBLIC_DIR);
    const tag = addPublicMigration(publicDir, 'example', 'CREATE TABLE `example` (`id` text PRIMARY KEY NOT NULL);\n');
    const line = sitesMigrationLine({ publicDir });
    expect(line.migrations.at(-1)).toEqual({ tag, sql: 'CREATE TABLE `example` (`id` text PRIMARY KEY NOT NULL);\n' });
    // The bridge there is the real one, not the public placeholder.
    const bridge = line.migrations.find((m) => m.tag === '0005_bridge_to_public');
    expect(bridge?.sql).toContain('CREATE TABLE `providers`');
  });

  it('refuses a public line whose names up to 0005 have changed', () => {
    // Every name up to 0005 is taken on Sites, so a migration that ended up
    // under one of them would be skipped there as already applied.
    const publicDir = tempCopy(PUBLIC_DIR);
    const renamed = '0005_something_else';
    renameSync(join(publicDir, `${PUBLIC_HEAD[5]}.sql`), join(publicDir, `${renamed}.sql`));
    const journal = JSON.parse(readFileSync(journalOf(publicDir), 'utf8'));
    journal.entries[5].tag = renamed;
    writeFileSync(journalOf(publicDir), JSON.stringify(journal));
    expect(() => sitesMigrationLine({ publicDir })).toThrow(/must stay/);
  });

  it('refuses a frozen migration that was edited', () => {
    const prefixDir = tempCopy(PREFIX_DIR);
    const file = join(prefixDir, '0001_dapper_justice.sql');
    writeFileSync(file, readFileSync(file, 'utf8').replace('`last_seen_at` integer', '`last_seen` integer'));
    expect(() => sitesMigrationLine({ prefixDir })).toThrow(/already applied/);
  });

  it('refuses a public migration dated before the bridge', () => {
    // drizzle's migrator would treat it as older than what Sites has applied.
    const publicDir = tempCopy(PUBLIC_DIR);
    addPublicMigration(publicDir, 'backdated', 'SELECT 1;\n', 1_700_000_000_000);
    expect(() => sitesMigrationLine({ publicDir })).toThrow(/dated before/);
  });

  it('refuses a migration file missing from the journal', () => {
    const publicDir = tempCopy(PUBLIC_DIR);
    const next = JSON.parse(readFileSync(journalOf(publicDir), 'utf8')).entries.length;
    writeFileSync(join(publicDir, `${String(next).padStart(4, '0')}_unrecorded.sql`), 'SELECT 1;\n');
    expect(() => sitesMigrationLine({ publicDir })).toThrow(/_journal\.json/);
  });

  it('writes the line only into an empty directory', () => {
    const out = mkdtempSync(join(tmpdir(), 'meshkeep-sites-out-'));
    scratch.push(out);
    const line = writeSitesMigrationLine(join(out, 'drizzle'));
    expect(readdirSync(join(out, 'drizzle')).filter((name) => name.endsWith('.sql'))).toEqual(line.migrations.map((m) => `${m.tag}.sql`));
    // A stale copy could keep a migration the line no longer has.
    expect(() => writeSitesMigrationLine(join(out, 'drizzle'))).toThrow(/not empty/);
  });
});

// Node 22's bundled SQLite is built without FTS5, which the search index
// needs. CI runs this part on Node 24; on any other version a missing FTS5 is
// a failure, not a skip.
function hasFts5() {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE VIRTUAL TABLE probe USING fts5(text)');
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}
const noFts5OnNode22 = !hasFts5() && process.versions.node.startsWith('22.');

type Migration = { tag: string; sql: string };

function migrate(db: DatabaseSync, migrations: Migration[]) {
  for (const migration of migrations) db.exec(migration.sql);
}

function freshDatabase(migrations: Migration[]) {
  const db = new DatabaseSync(':memory:');
  migrate(db, migrations);
  return db;
}

const squash = (sql: string) => sql.replace(/\s+/g, ' ').trim();

// What the application depends on: tables with their columns, keys and
// foreign keys; indexes; triggers; the full-text tables. Column ORDER is left
// out on purpose. ALTER TABLE adds a column at the end, so `invites.token_hash`
// sits elsewhere on Sites, and nothing reads columns by position: drizzle names
// them and so does the restore script.
function schemaOf(db: DatabaseSync) {
  const objects = db
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ type: string; name: string; sql: string | null }>;
  const schema: Record<string, unknown> = {};
  for (const { type, name, sql } of objects) {
    if (type === 'table' && !sql?.startsWith('CREATE VIRTUAL')) {
      const columns = db.prepare(`PRAGMA table_info(\`${name}\`)`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>;
      const foreignKeys = db.prepare(`PRAGMA foreign_key_list(\`${name}\`)`).all() as Array<{ from: string; table: string; to: string; on_delete: string }>;
      schema[`table ${name}`] = {
        columns: Object.fromEntries(columns.map((c) => [c.name, `${c.type} notnull=${c.notnull} default=${c.dflt_value} pk=${c.pk}`]).sort(([a], [b]) => String(a).localeCompare(String(b)))),
        foreignKeys: foreignKeys.map((fk) => `${fk.from} -> ${fk.table}.${fk.to} on delete ${fk.on_delete}`).sort(),
      };
    } else {
      schema[`${type} ${name}`] = sql ? squash(sql) : null;
    }
  }
  return schema;
}

describe.skipIf(noFts5OnNode22)('Sites migration line on SQLite', () => {
  const readPublic = (dir = PUBLIC_DIR) => readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ tag: name.slice(0, -'.sql'.length), sql: readFileSync(join(dir, name), 'utf8') }));

  it('ends with the same schema as the public line on a fresh database', () => {
    expect(schemaOf(freshDatabase(sitesMigrationLine().migrations))).toEqual(schemaOf(freshDatabase(readPublic())));
  });

  it('tells schemas apart when a column, an index or a trigger differs', () => {
    const base = schemaOf(freshDatabase(readPublic()));
    for (const change of [
      'ALTER TABLE `projects` ADD `extra` text',
      'CREATE INDEX `projects_name_idx` ON `projects` (`name`)',
      'DROP TRIGGER `messages_fts_au`',
    ]) {
      const db = freshDatabase(readPublic());
      db.exec(change);
      expect(schemaOf(db), change).not.toEqual(base);
    }
  });

  it('still matches after a new public migration', () => {
    const publicDir = tempCopy(PUBLIC_DIR);
    addPublicMigration(publicDir, 'example', 'CREATE TABLE `example` (`id` text PRIMARY KEY NOT NULL);\nALTER TABLE `invites` ADD `note` text;\n');
    const sites = schemaOf(freshDatabase(sitesMigrationLine({ publicDir }).migrations));
    expect(sites).toEqual(schemaOf(freshDatabase(readPublic(publicDir))));
    expect(sites).toHaveProperty('table example');
  });

  it('upgrades a database that has the old line, keeps its rows and makes them searchable', () => {
    const line = sitesMigrationLine().migrations;
    const db = new DatabaseSync(':memory:');
    // What the Sites database held before the bridge: 0000-0004 applied.
    migrate(db, line.slice(0, 5));
    db.exec(`
      INSERT INTO members (id, provider_user_id, email, display_name, role) VALUES ('m1', 'p1', 'owner@example.test', 'Owner', 'owner');
      INSERT INTO projects (id, owner_id, name) VALUES ('p1', 'm1', 'Projekt');
      INSERT INTO conversations (id, project_id, created_by, title) VALUES ('c1', 'p1', 'm1', 'Rozmowa');
      INSERT INTO messages (id, conversation_id, member_id, role, content) VALUES ('x1', 'c1', 'm1', 'user', 'Gdzie jest żółw?');
      INSERT INTO invites (id, email, created_by, expires_at, token_hash) VALUES ('i1', 'guest@example.test', 'm1', 0, 'hash');
    `);
    migrate(db, line.slice(5));

    expect(schemaOf(db)).toEqual(schemaOf(freshDatabase(readPublic())));
    expect(db.prepare('SELECT instructions FROM projects WHERE id = ?').get('p1')).toEqual({ instructions: '' });
    expect(db.prepare('SELECT token_hash FROM invites WHERE id = ?').get('i1')).toEqual({ token_hash: 'hash' });
    // The bridge rebuilds the index, so an old message is found the way the
    // search box looks for it, typed without Polish letters.
    const search = db.prepare('SELECT m.id FROM messages_fts f JOIN messages m ON m.rowid = f.rowid WHERE messages_fts MATCH ?');
    expect(search.all(buildMatchQuery('zolw'))).toEqual([{ id: 'x1' }]);
  });

  it('stops at the first migration if the platform forgets what it applied', () => {
    // Nothing is applied twice: 0000 fails at once, because its tables exist.
    const line = sitesMigrationLine().migrations;
    const db = freshDatabase(line);
    db.exec("INSERT INTO members (id, provider_user_id, email, display_name) VALUES ('m1', 'p1', 'owner@example.test', 'Owner')");
    expect(() => migrate(db, line)).toThrow(/already exists/);
    expect(db.prepare('SELECT count(*) AS n FROM members').get()).toEqual({ n: 1 });
  });
});
