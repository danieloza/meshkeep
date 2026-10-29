import 'server-only';

import { and, count, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import { files, fileTexts } from '@/db/schema';
import { jestDokumentem, jestZwyklymTekstem, rozszerzeniePliku, trescPliku } from './file-text';

// Enough for the parts of a file people search for, small enough that one row
// stays far below D1's 2 MB row limit even in multi-byte text.
const MAX_INDEXED_CHARS = 100_000;
// Documents are extracted a few at a time, so one request never spends long
// enough on PDFs to run into the platform's CPU limit.
const FILES_PER_ROUND = 5;

type IndexableFile = { id: string; projectId: string; relativePath: string; name: string; objectKey: string; sizeBytes: number };

function indexRow(file: IndexableFile, content: string) {
  return { fileId: file.id, projectId: file.projectId, path: file.relativePath, content: content.slice(0, MAX_INDEXED_CHARS), indexedAt: new Date() };
}

// At upload the bytes are already in memory, so plain text is indexed in the
// same request as the file itself. Documents need extraction, which is slow
// enough to leave to an indexing round: `null` leaves them pending. Other
// types have no readable text and are indexed by path only.
export async function uploadIndexRow(file: IndexableFile, bytes: Uint8Array<ArrayBuffer>) {
  const extension = rozszerzeniePliku(file.name);
  if (jestDokumentem(extension)) return null;
  const content = jestZwyklymTekstem(extension) ? (await trescPliku(file, extension, bytes)).tekst : '';
  return indexRow(file, content);
}

// D1 accepts at most 100 bound parameters per statement, so rows go in one
// statement each, sent together in a single batch.
export async function insertIndexRows(rows: Array<ReturnType<typeof indexRow>>) {
  if (!rows.length) return;
  const db = getDb();
  const [first, ...rest] = rows.map((row) => db.insert(fileTexts).values(row).onConflictDoNothing());
  await db.batch([first, ...rest]);
}

function pendingFiles(projectId: string) {
  return and(eq(files.projectId, projectId), isNull(fileTexts.fileId));
}

// Indexes files that have no searchable text yet: documents after upload, and
// files uploaded before search existed. Called when a project is opened and
// after an import, a bounded round at a time.
export async function indexPendingFiles(projectId: string) {
  const db = getDb();
  const pending = await db
    .select({ id: files.id, projectId: files.projectId, relativePath: files.relativePath, name: files.name, objectKey: files.objectKey, sizeBytes: files.sizeBytes })
    .from(files)
    .leftJoin(fileTexts, eq(fileTexts.fileId, files.id))
    .where(pendingFiles(projectId))
    .limit(FILES_PER_ROUND);

  const rows = [];
  for (const file of pending) {
    let content = '';
    // A file that cannot be read is still indexed, by path, so it is not
    // retried on every round.
    try { content = (await trescPliku(file, rozszerzeniePliku(file.name))).tekst; } catch { content = ''; }
    rows.push(indexRow(file, content));
  }
  // A file deleted while it was being read fails its foreign key; the rest of
  // the round still counts.
  try { await insertIndexRows(rows); } catch { for (const row of rows) await insertIndexRows([row]).catch(() => undefined); }

  const [{ value: remaining }] = await db
    .select({ value: count() })
    .from(files)
    .leftJoin(fileTexts, eq(fileTexts.fileId, files.id))
    .where(pendingFiles(projectId));
  return { indexed: pending.length, remaining };
}
