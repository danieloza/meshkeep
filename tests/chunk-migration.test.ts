import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const dir = join(import.meta.dirname, '..', 'drizzle');
const sql = (name: string) => readFileSync(join(dir, name), 'utf8');
const migration = sql('0009_file_chunks.sql');

function hasFts5() {
  const db = new DatabaseSync(':memory:');
  try { db.exec('CREATE VIRTUAL TABLE probe USING fts5(text)'); return true; } catch { return false; } finally { db.close(); }
}

function previousDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const name of readdirSync(dir).filter((n) => /^000[0-8]_.*\.sql$/.test(n)).sort()) db.exec(sql(name));
  db.exec(`
    INSERT INTO members (id, provider_user_id, email, display_name) VALUES ('m', 'user', 'm@example.test', 'Member');
    INSERT INTO projects (id, owner_id, name, instructions) VALUES ('p', 'm', 'Project', 'Keep this');
    INSERT INTO projects (id, owner_id, name) VALUES ('q', 'm', 'Other project');
    INSERT INTO files (id, project_id, uploaded_by, object_key, relative_path, name, mime_type, size_bytes, sha256, created_at) VALUES
      ('f1', 'p', 'm', 'obj1', 'first.txt', 'first.txt', 'text/plain', 42, 'same-sha', 123),
      ('f2', 'p', 'm', 'obj2', 'second.txt', 'second.txt', 'text/plain', 42, 'same-sha', 456),
      ('f3', 'q', 'm', 'obj3', 'first.txt', 'first.txt', 'text/plain', 42, 'same-sha', 789);
    INSERT INTO file_texts (file_id, project_id, path, content, status, reason, attempts, indexed_at) VALUES
      ('f1', 'p', 'first.txt', 'existing text', 'failed', 'retry later', 2, 987),
      ('f2', 'p', 'second.txt', '', 'unsupported', 'no text', 1, 876);
    INSERT INTO conversations (id, project_id, created_by, title, created_at, updated_at) VALUES ('c', 'p', 'm', 'A conversation', 111, 222);
    INSERT INTO messages (id, conversation_id, member_id, role, content, model, input_tokens, output_tokens, context_files, created_at)
      VALUES ('msg', 'c', 'm', 'assistant', 'old answer', 'model', 12, 34, '["first.txt"]', 333);
  `);
  return db;
}

function snapshot(db: DatabaseSync) {
  return Object.fromEntries(['members', 'projects', 'files', 'file_texts', 'conversations', 'messages'].map((table) => [
    table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
  ]));
}

function apply(db: DatabaseSync) {
  // The actual migration runner executes individual breakpoints; do not assume
  // the migration as a whole is wrapped in a transaction.
  for (const statement of migration.split('--> statement-breakpoint')) db.exec(statement);
}

function match(db: DatabaseSync, query: string) {
  return db.prepare(`SELECT c.file_id, c.ordinal FROM file_chunks_fts AS f
    JOIN file_chunks AS c ON c.rowid = f.rowid WHERE file_chunks_fts MATCH ? ORDER BY c.file_id, c.ordinal`).all(query);
}

// Node 22's bundled SQLite may lack FTS5; Node 24 CI must execute these tests.
describe.skipIf(!hasFts5() && process.versions.node.startsWith('22.'))('chunk migration', () => {
  it('preserves existing rows and keeps equal-content files independently searchable', () => {
    const db = previousDatabase();
    try {
      const before = snapshot(db);
      apply(db);
      expect(snapshot(db)).toEqual(before);
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      db.exec(`
        INSERT INTO file_chunk_states VALUES ('f1', 'p', 'same-sha', 'v1', 'indexed', 1, NULL, 10, 1, NULL, 20);
        INSERT INTO file_chunk_states VALUES ('f2', 'p', 'same-sha', 'v1', 'indexed', 1, NULL, 10, 1, NULL, 20);
        INSERT INTO file_chunks VALUES ('f1', 'p', 'first.txt', 0, 'same-key', 0, 8, 'café tea', 'intro', 'page 1', 'Heading', 0);
        INSERT INTO file_chunks VALUES ('f2', 'p', 'second.txt', 0, 'same-key', 0, 8, 'café tea', 'intro', 'page 1', 'Heading', 0);
      `);
      expect(match(db, 'cafe')).toEqual([{ file_id: 'f1', ordinal: 0 }, { file_id: 'f2', ordinal: 0 }]);
      expect(() => db.exec("INSERT INTO file_chunks VALUES ('missing', 'p', 'x', 0, 'k', 0, 1, 'x', '', '', '', 0)")).toThrow(/FOREIGN KEY/);
      expect(() => db.exec("UPDATE file_chunk_states SET status = 'bad' WHERE file_id = 'f1'")).toThrow(/CHECK/);
      expect(() => db.exec("UPDATE files SET relative_path = 'first.txt' WHERE id = 'f2'")).toThrow(/UNIQUE/);
    } finally { db.close(); }
  });

  it('updates all indexed columns and removes postings on direct and cascade deletes', () => {
    const db = previousDatabase();
    try {
      apply(db);
      db.exec(`
        INSERT INTO file_chunk_states VALUES ('f1', 'p', 'sha', 'v1', 'indexing', 1, 'lease', 10, 2, NULL, 0);
        INSERT INTO file_chunks VALUES ('f1', 'p', 'oldpath', 0, 'k', 0, 3, 'oldbody', 'oldlabel', '', '', 0);
        INSERT INTO file_chunks VALUES ('f1', 'p', 'otherpath', 1, 'k2', 3, 6, 'otherbody', 'otherlabel', '', '', 0);
      `);
      for (const term of ['oldpath', 'oldlabel', 'oldbody']) expect(match(db, term)).toEqual([{ file_id: 'f1', ordinal: 0 }]);
      db.exec("UPDATE file_chunks SET path='newpath', label='newlabel', content='newbody' WHERE file_id='f1' AND ordinal=0");
      for (const term of ['oldpath', 'oldlabel', 'oldbody']) expect(match(db, term)).toEqual([]);
      for (const term of ['newpath', 'newlabel', 'newbody']) expect(match(db, term)).toEqual([{ file_id: 'f1', ordinal: 0 }]);
      db.exec("DELETE FROM file_chunks WHERE file_id='f1' AND ordinal=0");
      for (const term of ['newpath', 'newlabel', 'newbody']) expect(match(db, term)).toEqual([]);
      expect(match(db, 'otherbody')).toEqual([{ file_id: 'f1', ordinal: 1 }]);
      db.exec("DELETE FROM files WHERE id='f1'");
      expect(match(db, 'otherbody')).toEqual([]);
      expect(db.prepare("SELECT * FROM file_chunk_states WHERE file_id='f1'").all()).toEqual([]);
      expect(db.prepare("SELECT * FROM file_chunks WHERE file_id='f1'").all()).toEqual([]);
      // External content queries alone can hide orphaned postings.
      db.exec("INSERT INTO file_chunks_fts(file_chunks_fts, rank) VALUES ('integrity-check', 1)");
    } finally { db.close(); }
  });

  it('rejects existing duplicate paths first, preserving all old rows without a transaction', () => {
    const db = previousDatabase();
    try {
      db.exec("UPDATE files SET relative_path='first.txt' WHERE id='f2'");
      const before = snapshot(db);
      expect(() => apply(db)).toThrow(/UNIQUE constraint failed: files\.project_id, files\.relative_path/);
      expect(snapshot(db)).toEqual(before);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('files_project_path_uq', 'file_chunks', 'file_chunk_states')").all()).toEqual([]);
    } finally { db.close(); }
  });
});
