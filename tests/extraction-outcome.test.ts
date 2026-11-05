import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { wydobadzTekstDokumentu } from '@/lib/document-text';
import { fileTextState, MAX_EXTRACTION_ATTEMPTS, outcomeOf } from '@/lib/extraction-outcome';
import { wydobadzTekstPdf } from '@/lib/server/pdf-text';

const bytes = (text: string) => new TextEncoder().encode(text) as Uint8Array<ArrayBuffer>;

describe('what an extraction result means for the index', () => {
  it('tells a failed read from a file with no text by design', () => {
    expect(outcomeOf({ tekst: '', powod: 'Could not read the PDF: broken.', blad: true })).toEqual({ status: 'failed', content: '', reason: 'Could not read the PDF: broken.' });
    expect(outcomeOf({ tekst: '', powod: 'This file type is not converted to text.' })).toEqual({ status: 'unsupported', content: '', reason: 'This file type is not converted to text.' });
  });

  it('keeps text, with the note when only part of it was read', () => {
    expect(outcomeOf({ tekst: 'Hello' })).toEqual({ status: 'indexed', content: 'Hello', reason: null });
    expect(outcomeOf({ tekst: 'Start', powod: 'Only the beginning was read.' })).toEqual({ status: 'indexed', content: 'Start', reason: 'Only the beginning was read.' });
  });

  it('treats an empty text file as read, not as a problem', () => {
    expect(outcomeOf({ tekst: '' })).toEqual({ status: 'indexed', content: '', reason: null });
  });

  it('gets the error flag from the real extractors', async () => {
    // A PDF header over garbage: the parser fails, and a later try may differ.
    expect(await wydobadzTekstPdf(bytes('%PDF-1.4\nnot a real body\n%%EOF'))).toMatchObject({ blad: true });
    // An archive without a Word document in it is not an error; it never will be one.
    const notWord = await wydobadzTekstDokumentu('docx', bytes('PK\u0003\u0004 not really a zip'));
    expect(notWord.blad).toBeUndefined();
    expect(outcomeOf(notWord).status).toBe('unsupported');
  });
});

describe('what the files panel says about a file', () => {
  it('is pending until a round has read it', () => {
    expect(fileTextState(null)).toEqual({ status: 'pending', note: null, retrying: false });
    expect(fileTextState({ status: 'extracting', reason: null, attempts: 1 })).toEqual({ status: 'pending', note: null, retrying: false });
    // An old empty row the migration queued for a first read.
    expect(fileTextState({ status: 'failed', reason: null, attempts: 0 })).toEqual({ status: 'pending', note: null, retrying: false });
  });

  it('says whether a failed read will be tried again', () => {
    expect(fileTextState({ status: 'failed', reason: 'Broken.', attempts: 1 })).toEqual({ status: 'failed', note: 'Broken.', retrying: true });
    expect(fileTextState({ status: 'failed', reason: 'Broken.', attempts: MAX_EXTRACTION_ATTEMPTS })).toEqual({ status: 'failed', note: 'Broken.', retrying: false });
  });

  it('passes on the reason for no text, and the note for partial text', () => {
    expect(fileTextState({ status: 'unsupported', reason: 'Images are not read.', attempts: 0 })).toEqual({ status: 'unsupported', note: 'Images are not read.', retrying: false });
    expect(fileTextState({ status: 'indexed', reason: 'Only the beginning.', attempts: 1 })).toEqual({ status: 'indexed', note: 'Only the beginning.', retrying: false });
  });
});

// Node 22's SQLite has no FTS5, which an earlier migration needs; CI runs this on Node 24.
function hasFts5() {
  const db = new DatabaseSync(':memory:');
  try { db.exec('CREATE VIRTUAL TABLE probe USING fts5(text)'); return true; } catch { return false; } finally { db.close(); }
}

describe.skipIf(!hasFts5() && process.versions.node.startsWith('22.'))('migration 0008', () => {
  it('queues every old row without text for one more read, and keeps the rest as indexed', () => {
    const dir = join(__dirname, '..', 'drizzle');
    const names = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
    const at = names.findIndex((name) => name.startsWith('0008_'));
    const db = new DatabaseSync(':memory:');
    for (const name of names.slice(0, at)) db.exec(readFileSync(join(dir, name), 'utf8'));
    db.exec(`
      INSERT INTO members (id, provider_user_id, email, display_name) VALUES ('m', 'p', 'm@example.test', 'M');
      INSERT INTO projects (id, owner_id, name) VALUES ('p', 'm', 'P');
      INSERT INTO files (id, project_id, uploaded_by, object_key, relative_path, name, mime_type, size_bytes, sha256) VALUES
        ('f1', 'p', 'm', 'o1', 'a.txt', 'a.txt', 'text/plain', 1, 'x'), ('f2', 'p', 'm', 'o2', 'b.pdf', 'b.pdf', 'application/pdf', 1, 'x');
      INSERT INTO file_texts (file_id, project_id, path, content) VALUES ('f1', 'p', 'a.txt', 'Some text'), ('f2', 'p', 'b.pdf', '');
    `);
    db.exec(readFileSync(join(dir, names[at]), 'utf8'));
    expect(db.prepare('SELECT file_id, status, reason, attempts FROM file_texts ORDER BY file_id').all()).toEqual([
      { file_id: 'f1', status: 'indexed', reason: null, attempts: 0 },
      { file_id: 'f2', status: 'failed', reason: null, attempts: 0 },
    ]);
  });
});
