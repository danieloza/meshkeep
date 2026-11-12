import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  read: vi.fn(),
  build: vi.fn(),
}));
vi.mock('@/db', () => ({ getDb: () => ({ $client: mocks.client }) }));
vi.mock('@/lib/server/context-file', () => ({ readContextDocument: mocks.read }));
vi.mock('@/lib/context-document', () => ({ buildContextChunks: mocks.build, CHUNK_EXTRACTOR_VERSION: 'v1' }));

import { indexPendingContextChunks } from '@/lib/server/context-index';

// Exercise the actual SQL on SQLite. batch() reproduces D1's atomic commit or
// rollback; the reader is mocked so tests can pause I/O at a precise point.
class Statement {
  args: Array<string | number | null> = [];
  constructor(private db: DatabaseSync, private text: string) {}
  bind(...args: Array<string | number | null>) { this.args = args; return this; }
  async run() { return this.execute(); }
  async all() { return { results: this.db.prepare(this.text).all(...this.args) }; }
  async first() { return this.db.prepare(this.text).get(...this.args) ?? null; }
  execute() { return { meta: { changes: Number(this.db.prepare(this.text).run(...this.args).changes) } }; }
}
class LocalD1 {
  constructor(readonly db: DatabaseSync) {}
  prepare(text: string) { return new Statement(this.db, text); }
  async batch(statements: Statement[]) {
    this.db.exec('BEGIN');
    try {
      const results = statements.map((statement) => statement.execute());
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

function hasFts5() {
  const db = new DatabaseSync(':memory:');
  try { db.exec('CREATE VIRTUAL TABLE probe USING fts5(text)'); return true; } catch { return false; } finally { db.close(); }
}

type File = { id: string; projectId: string; relativePath: string };
function row(file: File, searchLabel = 'full searchable tail') {
  return { fileId: file.id, projectId: file.projectId, path: file.relativePath, ordinal: 0, chunkKey: 'key',
    startChar: 0, endChar: 4, content: 'body', label: 'short', searchLabel, place: '', heading: '', headerCut: 1 };
}

describe.skipIf(!hasFts5() && process.versions.node.startsWith('22.'))('context chunk indexing', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T12:00:00Z'));
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    const dir = join(import.meta.dirname, '..', 'drizzle');
    for (const name of readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, name), 'utf8'));
    db.exec(`INSERT INTO members (id, provider_user_id, email, display_name) VALUES ('m','u','m@example.test','M');
      INSERT INTO projects (id,owner_id,name) VALUES ('p','m','P'),('q','m','Q');`);
    mocks.client = new LocalD1(db);
    mocks.read.mockReset().mockResolvedValue({ document: { text: 'body' }, reason: null, failed: false });
    mocks.build.mockReset().mockImplementation(async (file: File) => ({ rows: [row(file)], truncated: false }));
  });
  afterEach(() => { db.close(); vi.useRealTimers(); });

  function addFile(id: string, project = 'p', status = 'indexed', text = '') {
    db.prepare(`INSERT INTO files (id,project_id,uploaded_by,object_key,relative_path,name,mime_type,size_bytes,sha256)
      VALUES (?,?,'m',?,?,?,'text/plain',4,'sha')`).run(id, project, `object-${id}`, `${id}.txt`, `${id}.txt`);
    db.prepare('INSERT INTO file_texts (file_id,project_id,path,content,status) VALUES (?,?,?,?,?)')
      .run(id, project, `${id}.txt`, text, status);
  }
  function state(id: string) { return db.prepare('SELECT * FROM file_chunk_states WHERE file_id=?').get(id); }
  function chunks(id: string) { return db.prepare('SELECT * FROM file_chunks WHERE file_id=? ORDER BY ordinal').all(id); }
  function find(word: string) {
    return db.prepare('SELECT c.file_id FROM file_chunks_fts x JOIN file_chunks c ON c.rowid=x.rowid WHERE file_chunks_fts MATCH ? ORDER BY c.file_id').all(word);
  }

  it('takes at most five indexed files in the requested project, including empty text', async () => {
    for (let i = 0; i < 6; i += 1) addFile(`a${i}`);
    addFile('elsewhere', 'q');
    addFile('notready', 'p', 'failed');
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 5, failed: 0, remaining: 1 });
    expect(mocks.read).toHaveBeenCalledTimes(5);
    expect(state('elsewhere')).toBeUndefined();
    expect(state('notready')).toBeUndefined();
    expect(find('tail')).toHaveLength(5);
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 1, failed: 0, remaining: 0 });
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 0, failed: 0, remaining: 0 });
  });

  it('allows the caller to bound a round while leaving due work for later', async () => {
    addFile('a'); addFile('b'); addFile('c');
    expect(await indexPendingContextChunks('p', 1)).toEqual({ processed: 1, failed: 0, remaining: 2 });
    expect(await indexPendingContextChunks('p', 2)).toEqual({ processed: 2, failed: 0, remaining: 0 });
  });

  it('retains full searchable labels, records truncation, and fails closed on size limits', async () => {
    addFile('a'); addFile('b');
    mocks.build.mockImplementation(async (file: File) => file.id === 'a'
      ? { rows: [row(file, 'header hiddenuniquetail')], truncated: true }
      : { rows: [row(file, 'x'.repeat(65_537))], truncated: false });
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 2, failed: 1, remaining: 0 });
    expect(find('hiddenuniquetail')).toEqual([{ file_id: 'a' }]);
    expect(state('a')).toMatchObject({ status: 'indexed', reason: expect.stringContaining('part') });
    expect(state('b')).toMatchObject({ status: 'failed', reason: expect.stringContaining('label exceeds') });
    expect(chunks('b')).toEqual([]);
  });

  it('delays retries, limits attempts and reindexes a changed version', async () => {
    addFile('a');
    mocks.read.mockResolvedValue({ document: null, reason: 'unreadable', failed: true });
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 1, failed: 1, remaining: 0 });
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 0, failed: 0, remaining: 0 });
    vi.advanceTimersByTime(5 * 60_000);
    await indexPendingContextChunks('p');
    vi.advanceTimersByTime(10 * 60_000);
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 1, failed: 1, remaining: 0 });
    expect(state('a')).toMatchObject({ status: 'failed', attempts: 3, reason: 'unreadable' });
    db.exec("UPDATE files SET sha256='new-sha' WHERE id='a'");
    mocks.read.mockResolvedValue({ document: { text: 'body' }, reason: null, failed: false });
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 1, failed: 0, remaining: 0 });
    expect(state('a')).toMatchObject({ status: 'indexed', attempts: 1, file_sha: 'new-sha' });
  });

  it('counts a retry that becomes due while the round is running', async () => {
    addFile('a');
    for (let i = 0; i < 5; i += 1) addFile(`b${i}`);
    db.prepare(`INSERT INTO file_chunk_states VALUES ('a','p','sha','v1','failed',1,NULL,0,0,'retry',?)`)
      .run(Date.now() - 5 * 60_000 + 1);
    mocks.build.mockImplementationOnce(async (file: File) => {
      vi.advanceTimersByTime(1);
      return { rows: [row(file)], truncated: false };
    });
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 5, failed: 0, remaining: 1 });
    expect(state('a')).toMatchObject({ status: 'failed', attempts: 1 });
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 1, failed: 0, remaining: 0 });
  });

  it('records an asynchronous chunk builder rejection as a delayed failure', async () => {
    addFile('a');
    mocks.build.mockRejectedValueOnce(new Error('chunk builder failed'));
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 1, failed: 1, remaining: 0 });
    expect(state('a')).toMatchObject({ status: 'failed', reason: 'chunk builder failed', lease_id: null });
    expect(chunks('a')).toEqual([]);
  });

  it('settles unsupported documents and expired final leases without retrying forever', async () => {
    addFile('a'); addFile('b');
    db.prepare(`INSERT INTO file_chunk_states VALUES ('b','p','sha','v1','indexing',3,'dead',?,0,NULL,0)`)
      .run(Date.now() - 2 * 60_000 - 1);
    mocks.read.mockResolvedValue({ document: null, reason: 'No supported document', failed: false });
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 1, failed: 0, remaining: 0 });
    expect(state('a')).toMatchObject({ status: 'unsupported', reason: 'No supported document', chunk_count: 0 });
    expect(state('b')).toMatchObject({ status: 'failed', lease_id: null, attempts: 3 });
  });

  it('prevents a stale worker from deleting or overwriting the newer lease and its FTS rows', async () => {
    addFile('a');
    let resume!: (value: unknown) => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => { started = resolve; });
    mocks.read.mockImplementationOnce(() => { started(); return new Promise((resolve) => { resume = resolve; }); });
    const old = indexPendingContextChunks('p');
    await reading;
    vi.advanceTimersByTime(2 * 60_000 + 1);
    mocks.build.mockImplementationOnce(async (file: File) => ({ rows: [row(file, 'newerword')], truncated: false }));
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 1, failed: 0, remaining: 0 });
    resume({ document: { text: 'old' }, reason: null, failed: false });
    await old;
    expect(state('a')).toMatchObject({ status: 'indexed', attempts: 2, lease_id: null });
    expect(find('newerword')).toEqual([{ file_id: 'a' }]);
    expect(find('tail')).toEqual([]);
  });

  it('allows only one of two simultaneous rounds to claim the same file', async () => {
    addFile('a');
    let resume!: (value: unknown) => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => { started = resolve; });
    mocks.read.mockImplementationOnce(() => { started(); return new Promise((resolve) => { resume = resolve; }); });
    const first = indexPendingContextChunks('p');
    await reading;
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 0, failed: 0, remaining: 0 });
    resume({ document: { text: 'body' }, reason: null, failed: false });
    expect(await first).toEqual({ processed: 1, failed: 0, remaining: 0 });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(state('a')).toMatchObject({ attempts: 1, status: 'indexed' });
  });

  it('rolls back all inserted chunks when a later insert fails and refuses more than 600 chunks', async () => {
    addFile('a'); addFile('b');
    await indexPendingContextChunks('p');
    db.exec(`UPDATE files SET sha256='new' WHERE id IN ('a','b');
      CREATE TRIGGER fail_chunk BEFORE INSERT ON file_chunks WHEN new.file_id='a' AND new.ordinal=6
      BEGIN SELECT RAISE(ABORT, 'simulated insert failure'); END;`);
    mocks.build.mockImplementation(async (file: File) => file.id === 'a'
      ? { rows: Array.from({ length: 7 }, (_, ordinal) => ({ ...row(file, 'replacement'), ordinal })), truncated: false }
      : { rows: Array.from({ length: 601 }, (_, ordinal) => ({ ...row(file), ordinal })), truncated: false });
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 2, failed: 2, remaining: 0 });
    expect(state('a')).toMatchObject({ status: 'failed', reason: expect.stringContaining('simulated insert failure') });
    expect(state('b')).toMatchObject({ status: 'failed', reason: expect.stringContaining('Chunk limit') });
    expect(find('tail')).toEqual([]);
    expect(find('replacement')).toEqual([]);
  });

  it('does not leave chunks after deletion or overwrite a replacement while reading', async () => {
    addFile('a'); addFile('b');
    mocks.read.mockImplementationOnce(async () => {
      db.exec("DELETE FROM files WHERE id='a'; UPDATE files SET sha256='replacement', object_key='replacement-object' WHERE id='b'");
      return { document: { text: 'old' }, reason: null, failed: false };
    });
    await indexPendingContextChunks('p');
    expect(state('a')).toBeUndefined();
    expect(chunks('a')).toEqual([]);
    expect(state('b')).toBeUndefined();
    expect(chunks('b')).toEqual([]);
    expect(await indexPendingContextChunks('p')).toEqual({ processed: 1, failed: 0, remaining: 0 });
    expect(state('b')).toMatchObject({ file_sha: 'replacement', status: 'indexed' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
