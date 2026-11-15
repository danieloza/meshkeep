import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chunkLocator, chunksOf, passagesText, type Document } from '@/lib/context-chunking';
import { buildContextChunks, CHUNK_EXTRACTOR_VERSION, contextDocument } from '@/lib/context-document';
import { contextFile } from '@/lib/contracts/conversations';
import { readContextFiles } from '@/lib/chat-stream';

const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@/db', () => ({ getDb: () => ({ $client: mocks.client }) }));

import { choosePassages, filePassages, needsPassages, PER_FILE_PASSAGE_CHARS, passageNote, WHOLE_FILE_CHARS } from '@/lib/server/context-passages';

// The real migrations and the real SQL on SQLite. batch() runs its statements
// in one transaction and returns their rows, as D1 does.
class Statement {
  args: Array<string | number | null> = [];
  constructor(private db: DatabaseSync, readonly text: string) {}
  bind(...args: Array<string | number | null>) { this.args = args; return this; }
  rows() { return this.db.prepare(this.text).all(...this.args); }
}
class LocalD1 {
  constructor(readonly db: DatabaseSync) {}
  prepare(text: string) { return new Statement(this.db, text); }
  async batch(statements: Statement[]) {
    this.db.exec('BEGIN');
    try {
      const results = statements.map((statement) => ({ results: statement.rows() }));
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

const SHA = 'a'.repeat(64);

// A guide of twenty sections, each about one animal, about 13 000 characters.
const ANIMALS = ['alpaca', 'badger', 'camel', 'dingo', 'eland', 'ferret', 'gibbon', 'heron', 'ibis', 'jackal',
  'koala', 'lemur', 'marmot', 'narwhal', 'ocelot', 'puffin', 'quokka', 'raven', 'serval', 'tapir'];
const GUIDE = `# Field guide\n\n${ANIMALS.map((animal, index) => `## Section ${index + 1}\n\n${`The ${animal} lives here and eats leaves. `.repeat(14)}\n\nRule ${index + 1}: feed the ${animal} at noon.`).join('\n\n')}\n`;

describe.skipIf(!hasFts5())('passages of a long file', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys=ON');
    const dir = join(import.meta.dirname, '..', 'drizzle');
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, name), 'utf8'));
    db.exec(`INSERT INTO members (id, provider_user_id, email, display_name) VALUES ('m','u','m@example.test','M');
      INSERT INTO projects (id,owner_id,name) VALUES ('p','m','P'),('q','m','Q');`);
    mocks.client = new LocalD1(db);
  });
  afterEach(() => db.close());

  type Indexed = { status?: string; version?: string; stateSha?: string; reason?: string | null; stateProject?: string };
  // A file and its chunks, stored as step A stores them.
  async function addFile(id: string, project: string, path: string, document: Document, indexed: Indexed | null = {}) {
    db.prepare(`INSERT INTO files (id,project_id,uploaded_by,object_key,relative_path,name,mime_type,size_bytes,sha256)
      VALUES (?,?,'m',?,?,?,'text/markdown',1,?)`).run(id, project, `object-${id}`, path, path.split('/').pop()!, SHA);
    db.prepare("INSERT INTO file_texts (file_id,project_id,path,content,status) VALUES (?,?,?,'','indexed')").run(id, project, path);
    if (!indexed) return;
    const { rows } = await buildContextChunks({ id, projectId: project, relativePath: path, sha256: SHA }, document);
    for (const row of rows) {
      db.prepare(`INSERT INTO file_chunks (file_id,project_id,path,ordinal,chunk_key,start_char,end_char,content,label,search_label,place,heading,header_cut)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.fileId, row.projectId, row.path, row.ordinal, row.chunkKey, row.startChar, row.endChar,
        row.content, row.label, row.searchLabel, row.place, row.heading, row.headerCut);
    }
    db.prepare(`INSERT INTO file_chunk_states (file_id,project_id,file_sha,extractor_version,status,attempts,claimed_at,chunk_count,reason,indexed_at)
      VALUES (?,?,?,?,?,1,0,?,?,0)`).run(id, indexed.stateProject ?? project, indexed.stateSha ?? SHA, indexed.version ?? CHUNK_EXTRACTOR_VERSION,
      indexed.status ?? 'indexed', rows.length, indexed.reason ?? null);
  }
  // `room`: what is left of the chat's total for this file, as the route passes it.
  const ask = (id: string, project: string, question: string, room = 80_000, sha = SHA, extractorNote?: string) =>
    filePassages({ id, projectId: project, sha256: sha }, question, room, extractorNote);

  const guide = contextDocument('md', GUIDE);
  const guideChunks = chunksOf(guide, true);

  it('sends a file of up to 6 000 characters whole and a longer one by passages', () => {
    expect(WHOLE_FILE_CHARS).toBe(6_000);
    expect(PER_FILE_PASSAGE_CHARS).toBe(6_000);
    expect(needsPassages('x'.repeat(6_000))).toBe(false);
    expect(needsPassages('x'.repeat(6_001))).toBe(true);
  });

  it('sends the passages that match, verbatim under their labels, and lists them', async () => {
    expect(GUIDE.length).toBeGreaterThan(WHOLE_FILE_CHARS);
    await addFile('g', 'p', 'docs/guide.md', guide);
    const result = await ask('g', 'p', 'When do I feed the quokka?');
    if (result.kind !== 'passages') throw new Error(result.kind);
    expect(result.text).toContain('Rule 17: feed the quokka at noon.');
    expect(result.text).toContain('[Field guide › Section 17]');
    // Exactly what the shared serialization writes for the listed chunks.
    expect(result.text).toBe(passagesText(guide, result.passages.map((passage) => guideChunks[passage.ordinal])));
    expect(result.note).toBe(`Passages of a longer file: ${result.passages.length} of ${guideChunks.length}.`);
    // The provider gets the same note, on its own line above the passages.
    expect(result.section).toBe(`[${result.note}]\n${result.text}`);
    expect(result.passages.every((passage) => contextFile.shape.passages.unwrap().element.safeParse(passage).success)).toBe(true);
    expect(result.passages.find((passage) => passage.locator && 'heading' in passage.locator && passage.locator.heading.endsWith('Section 17'))).toBeTruthy();
  });

  it('never exceeds the allowance or the room left, labels, separators and the note counted', async () => {
    await addFile('g', 'p', 'docs/guide.md', guide);
    for (const room of [300, 700, 1_500, 2_000, 3_333, 6_000, 6_100, 80_000]) {
      for (const question of ['feed the quokka and the alpaca and the tapir', 'leaves noon', 'nothing like this at all']) {
        const result = await ask('g', 'p', question, room);
        if (result.kind !== 'passages') continue;
        // The passages keep the simulation's allowance; the note line is paid from the room.
        expect(result.text.length).toBeLessThanOrEqual(PER_FILE_PASSAGE_CHARS);
        expect(result.section.length).toBeLessThanOrEqual(room);
      }
    }
    // With room to spare for the note, the note does not shrink the passages' allowance.
    const roomy = await ask('g', 'p', 'feed the quokka and the alpaca and the tapir', 80_000);
    const tight = await ask('g', 'p', 'feed the quokka and the alpaca and the tapir', PER_FILE_PASSAGE_CHARS + 200);
    if (roomy.kind !== 'passages' || tight.kind !== 'passages') throw new Error('passages expected');
    expect(tight.passages).toEqual(roomy.passages);
    // Several sections were asked for: their labels and the omission marks are in the text and counted.
    const wide = await ask('g', 'p', 'feed the quokka and the alpaca and the tapir', 6_000);
    if (wide.kind !== 'passages') throw new Error(wide.kind);
    expect(wide.text).toContain('[…]');
    expect(wide.text.length).toBeLessThanOrEqual(6_000);
  });

  it('sends a file whose actual note and passages fit the room exactly, and not one character less', async () => {
    await addFile('g', 'p', 'docs/guide.md', guide);
    // A match: the longer no-match note cannot apply, so it is not reserved.
    const ample = await ask('g', 'p', 'quokka');
    if (ample.kind !== 'passages') throw new Error(ample.kind);
    expect(await ask('g', 'p', 'quokka', ample.section.length)).toEqual(ample);
    expect(await ask('g', 'p', 'quokka', ample.section.length - 1)).toEqual({ kind: 'none' });
    // No match: the same, with the no-match note.
    const beginning = await ask('g', 'p', 'zzzz');
    if (beginning.kind !== 'passages') throw new Error(beginning.kind);
    expect(await ask('g', 'p', 'zzzz', beginning.section.length)).toEqual(beginning);
  });

  it('reserves the note for the count actually sent, digits included', async () => {
    // Fifteen small sheets: every chunk matches, and all fit, so the count has two digits.
    const sheets = contextDocument('xlsx', Array.from({ length: 15 }, (_, index) => `# sheet${index + 1}.xml\nName\tValue\nrow ${index}\t${index}`).join('\n'));
    await addFile('s', 'p', 'data/many.xlsx', sheets);
    const ample = await ask('s', 'p', 'Value');
    if (ample.kind !== 'passages') throw new Error(ample.kind);
    expect(ample.passages).toHaveLength(15);
    // A note for 9 passages is one character shorter than for 15: that character must not
    // let in more than the room holds, nor cost a passage when the room is exact.
    expect(await ask('s', 'p', 'Value', ample.section.length)).toEqual(ample);
    const short = await ask('s', 'p', 'Value', ample.section.length - 1);
    if (short.kind !== 'passages') throw new Error(short.kind);
    expect(short.section.length).toBeLessThanOrEqual(ample.section.length - 1);
    expect(short.passages.length).toBeLessThan(15);
  });

  it('reserves the note before choosing: a passage that fits only without its note is not sent', async () => {
    await addFile('g', 'p', 'docs/guide.md', guide);
    // One chunk holds "quokka"; with room to spare it goes alone.
    const alone = await ask('g', 'p', 'quokka');
    if (alone.kind !== 'passages') throw new Error(alone.kind);
    expect(alone.passages.length).toBeGreaterThan(0);
    // Room for its text, not for its text and the note line.
    const room = alone.text.length + 5;
    const tight = await ask('g', 'p', 'quokka', room);
    if (tight.kind === 'passages') expect(tight.section.length).toBeLessThanOrEqual(room);
    else expect(tight).toEqual({ kind: 'none' });
    // With room for the longest note as well, it is sent.
    const enough = await ask('g', 'p', 'quokka', alone.text.length + 400);
    expect(enough.kind === 'passages' && enough.text).toBe(alone.text);
  });

  it("adds up each run's passage lengths to the body sent under its label", async () => {
    await addFile('g', 'p', 'docs/guide.md', guide);
    const result = await ask('g', 'p', 'feed the quokka and the raven and the alpaca', 6_000);
    if (result.kind !== 'passages') throw new Error(result.kind);
    const choice = choosePassages(guide, guideChunks, guideChunks.map(() => 'k'.repeat(20)), result.passages.map((passage) => passage.ordinal), 6_000)!;
    const bodies = choice.text.split(/\n\n(?:\[…\]\n\n)?(?=\[)/).map((run) => run.slice(run.indexOf('\n') + 1));
    const lengths: number[] = [];
    let previous: number | null = null;
    for (const passage of result.passages) {
      if (previous !== null && passage.ordinal === previous + 1 && JSON.stringify(chunkLocator(guideChunks[passage.ordinal])) === JSON.stringify(chunkLocator(guideChunks[previous]))) lengths[lengths.length - 1] += passage.length;
      else lengths.push(passage.length);
      previous = passage.ordinal;
    }
    expect(lengths).toEqual(bodies.map((body) => body.length));
  });

  it('brings the linked piece of a cut line along', async () => {
    const document = contextDocument('txt', `Intro words.\n\n${'filler '.repeat(214)}ABCDEF1234 ${'tail '.repeat(300)}zebracorn\n\nOutro words. ${'more '.repeat(300)}`);
    const chunks = chunksOf(document, true);
    expect(chunks.some((chunk) => chunk.continuesPrevious)).toBe(true);
    await addFile('cut', 'p', 'notes/cut.txt', document);
    const result = await ask('cut', 'p', 'zebracorn');
    if (result.kind !== 'passages') throw new Error(result.kind);
    const holder = chunks.find((chunk) => chunk.text.includes('zebracorn'))!;
    const ordinals = result.passages.map((passage) => passage.ordinal);
    expect(ordinals).toContain(holder.ordinal);
    expect(ordinals).toContain(holder.continuesPrevious ? holder.ordinal - 1 : holder.ordinal + 1);
  });

  it('falls back when the chunks are not current: stale version, other bytes, not indexed, failed, unsupported', async () => {
    const cases: Array<[string, Indexed | null]> = [
      ['stale', { version: String(Number(CHUNK_EXTRACTOR_VERSION) - 1) }],
      ['changed', { stateSha: 'b'.repeat(64) }],
      ['never', null],
      ['failed', { status: 'failed' }],
      ['unsupported', { status: 'unsupported' }],
      ['indexing', { status: 'indexing' }],
      ['moved', { stateProject: 'q' }],
    ];
    for (const [id, indexed] of cases) {
      await addFile(id, 'p', `docs/${id}.md`, guide, indexed);
      expect(await ask(id, 'p', 'quokka'), id).toEqual({ kind: 'unavailable', reason: expect.any(String) });
    }
    // The route's own copy of the file row must still describe the file.
    await addFile('current', 'p', 'docs/current.md', guide);
    expect((await ask('current', 'p', 'quokka')).kind).toBe('passages');
    expect(await ask('current', 'p', 'quokka', 6_000, 'c'.repeat(64))).toEqual({ kind: 'unavailable', reason: expect.any(String) });
  });

  it('never takes a passage from a file of another project', async () => {
    await addFile('mine', 'p', 'docs/guide.md', contextDocument('md', GUIDE.replaceAll('quokka', 'wombat')));
    await addFile('theirs', 'q', 'docs/guide.md', guide);
    expect(await ask('theirs', 'p', 'quokka')).toEqual({ kind: 'unavailable', reason: expect.any(String) });
    const mine = await ask('mine', 'p', 'quokka');
    if (mine.kind !== 'passages') throw new Error(mine.kind);
    expect(mine.text).not.toContain('quokka');
  });

  it('says when only part of the file could be searched', async () => {
    await addFile('part', 'p', 'docs/part.md', guide, { reason: 'Only the beginning of this file was indexed for passages.' });
    const result = await ask('part', 'p', 'quokka');
    if (result.kind !== 'passages') throw new Error(result.kind);
    expect(result.note).toMatch(/^Passages of a longer file: \d+ of \d+\. The rest of the file could not be searched\.$/);
    expect(result.section.split('\n')[0]).toBe(`[${result.note}]`);
    // The extractor's own warning travels with it.
    const warned = await ask('part', 'p', 'quokka', 80_000, SHA, 'The document has 41 pages; only text from the beginning was added to context.');
    if (warned.kind !== 'passages') throw new Error(warned.kind);
    expect(warned.note).toMatch(/The rest of the file could not be searched\. The document has 41 pages; only text from the beginning was added to context\.$/);
    expect(warned.section.split('\n')[0]).toBe(`[${warned.note}]`);
  });

  it('sends the beginning when no passage matches, and skips only when nothing fits', async () => {
    await addFile('g', 'p', 'docs/guide.md', guide);
    for (const question of ['zzzz qqqq', 'co to?']) {
      const result = await ask('g', 'p', question);
      if (result.kind !== 'passages') throw new Error(result.kind);
      expect(result.note).toBe(`Passages of a longer file: no passage matched the question; the beginning of the file was sent (${result.passages.length} of ${guideChunks.length}).`);
      expect(result.passages[0].ordinal).toBe(0);
      expect(result.text.startsWith('[Field guide]\n# Field guide\n\n## Section 1')).toBe(true);
      expect(result.section.startsWith(`[${result.note}]\n[Field guide]\n`)).toBe(true);
    }
    expect(await ask('g', 'p', 'zzzz', 20)).toEqual({ kind: 'none' });
    expect(await ask('g', 'p', 'quokka', 20)).toEqual({ kind: 'none' });
  });

  it('does not let the display label make a candidate', async () => {
    // "columns" is written only into the display label of a sheet's chunks.
    const sheet = contextDocument('xlsx', `# sheet1.xml\nName\tValue\n${Array.from({ length: 400 }, (_, index) => `row ${index}\t${index}`).join('\n')}`);
    expect(chunksOf(sheet, true).length).toBeGreaterThan(2);
    await addFile('s', 'p', 'data/book.xlsx', sheet);
    expect(db.prepare("SELECT COUNT(*) AS n FROM file_chunks_fts WHERE file_chunks_fts MATCH 'columns'").get()).toEqual({ n: expect.any(Number) });
    expect(Number((db.prepare("SELECT COUNT(*) AS n FROM file_chunks_fts WHERE file_chunks_fts MATCH 'columns'").get() as { n: number }).n)).toBeGreaterThan(0);
    const result = await ask('s', 'p', 'columns');
    if (result.kind !== 'passages') throw new Error(result.kind);
    expect(result.note).toContain('no passage matched the question');
    // The full header is in the search label, so a column name still finds rows.
    const named = await ask('s', 'p', 'Value of row 399');
    if (named.kind !== 'passages') throw new Error(named.kind);
    expect(named.note).toMatch(/^Passages of a longer file: \d+ of \d+\.$/);
    expect(named.text).toContain('[sheet 1 · columns: Name | Value]');
  });
});

describe('the note on a file sent by passages', () => {
  it('states every fact the manifest states, on one line', () => {
    expect(passageNote({ count: 3, total: 40, matched: true, partial: false })).toBe('Passages of a longer file: 3 of 40.');
    expect(passageNote({ count: 3, total: 40, matched: true, partial: true, extractorNote: 'The document has 41 pages; only text from the beginning was added to context.' }))
      .toBe('Passages of a longer file: 3 of 40. The rest of the file could not be searched. The document has 41 pages; only text from the beginning was added to context.');
    expect(passageNote({ count: 2, total: 9, matched: false, partial: false })).toContain('no passage matched the question; the beginning of the file was sent (2 of 9)');
    expect(passageNote({ count: 1, total: 2, matched: true, partial: false, extractorNote: 'Line one.\nLine two.' })).not.toContain('\n');
  });
});

describe('stored answers', () => {
  it('reads an answer stored before passages, and drops only a malformed list', () => {
    const old = JSON.stringify([{ id: '30000000-0000-4000-8000-000000000001', path: 'a.md', status: 'truncated', note: 'Only the beginning fit within the context limit.' }]);
    expect(readContextFiles(old)).toEqual(JSON.parse(old));
    const good = { id: '30000000-0000-4000-8000-000000000001', path: 'a.md', status: 'truncated', passages: [{ ordinal: 3, chunkKey: 'a'.repeat(20), locator: { heading: 'A › B' }, length: 120 }] };
    expect(readContextFiles(JSON.stringify([good]))).toEqual([good]);
    const bad = { ...good, passages: [{ ordinal: -1, chunkKey: 'nope', length: 0 }] };
    expect(readContextFiles(JSON.stringify([bad]))).toEqual([{ id: good.id, path: good.path, status: 'truncated' }]);
    // The hand-written check agrees with the contract: what it keeps parses,
    // what it drops would not.
    const passage = good.passages[0];
    const variants = [
      passage, { ...passage, locator: { page: 2 } }, { ...passage, locator: { sheet: 1 } }, { ordinal: 0, chunkKey: 'b'.repeat(20), length: 1 },
      { ...passage, locator: { page: 0 } }, { ...passage, locator: { heading: '' } }, { ...passage, locator: { page: 2, sheet: 1 } },
      { ...passage, locator: { row: 2 } }, { ...passage, ordinal: 1.5 }, { ...passage, length: 0 }, { ...passage, chunkKey: 'A'.repeat(20) }, null, 'text',
    ];
    for (const variant of variants) {
      const [entry] = readContextFiles(JSON.stringify([{ ...good, passages: [variant] }]));
      expect(contextFile.safeParse(entry).success).toBe(true);
      expect('passages' in entry, JSON.stringify(variant)).toBe(contextFile.shape.passages.safeParse([variant]).success);
    }
    expect(readContextFiles(JSON.stringify([{ ...good, passages: 'no' }]))).toEqual([{ id: good.id, path: good.path, status: 'truncated' }]);
    // 2^53 is an integer, but not a safe one: the contract refuses it, and so does the check.
    const unsafe = 2 ** 53;
    for (const variant of [{ ...passage, ordinal: unsafe }, { ...passage, length: unsafe }, { ...passage, locator: { page: unsafe } }, { ...passage, locator: { sheet: unsafe } }]) {
      const [entry] = readContextFiles(JSON.stringify([{ ...good, passages: [variant] }]));
      expect(entry, JSON.stringify(variant)).toEqual({ id: good.id, path: good.path, status: 'truncated' });
      expect(contextFile.safeParse(entry).success).toBe(true);
      expect(contextFile.shape.passages.safeParse([variant]).success).toBe(false);
    }
    // The largest safe integer still passes, as it does the contract.
    const [largest] = readContextFiles(JSON.stringify([{ ...good, passages: [{ ...passage, ordinal: Number.MAX_SAFE_INTEGER }] }]));
    expect('passages' in largest).toBe(true);
    expect(contextFile.safeParse(largest).success).toBe(true);
  });
});
