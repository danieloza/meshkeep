import 'server-only';

import { and, count, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { files, fileTexts } from '@/db/schema';
import { EXTRACTING_STALE_MS, MAX_EXTRACTION_ATTEMPTS, outcomeOf, type Outcome, RETRY_AFTER_MS } from '@/lib/extraction-outcome';
import { jestDokumentem, rozszerzeniePliku, trescPliku } from './file-text';
import { indexPendingContextChunks } from './context-index';

// Enough for the parts of a file people search for, small enough that one row
// stays far below D1's 2 MB row limit even in multi-byte text.
const MAX_INDEXED_CHARS = 100_000;
// Documents are extracted a few at a time, so one request never spends long
// enough on PDFs to run into the platform's CPU limit.
const FILES_PER_ROUND = 5;

type IndexableFile = { id: string; projectId: string; relativePath: string; name: string; objectKey: string; sizeBytes: number };

function indexRow(file: IndexableFile, outcome: Outcome, now = new Date()) {
  return {
    fileId: file.id,
    projectId: file.projectId,
    path: file.relativePath,
    content: outcome.content.slice(0, MAX_INDEXED_CHARS),
    status: outcome.status,
    reason: outcome.reason,
    indexedAt: now,
  };
}

// At upload the bytes are already in memory, so anything that is not a
// document is settled in the same request as the file itself: plain text is
// indexed, other types are recorded as having no text, with the reason.
// Documents need extraction, which is slow enough to leave to an indexing
// round: `null` leaves them pending.
export async function uploadIndexRow(file: IndexableFile, bytes: Uint8Array<ArrayBuffer>) {
  const extension = rozszerzeniePliku(file.name);
  if (jestDokumentem(extension)) return null;
  return indexRow(file, outcomeOf(await trescPliku(file, extension, bytes)));
}

// D1 accepts at most 100 bound parameters per statement, so rows go in one
// statement each, sent together in a single batch.
export async function insertIndexRows(rows: Array<ReturnType<typeof indexRow>>) {
  if (!rows.length) return;
  const db = getDb();
  const [first, ...rest] = rows.map((row) => db.insert(fileTexts).values(row).onConflictDoNothing());
  await db.batch([first, ...rest]);
}

// A file is waiting for a round when it has no row yet, when its last read
// failed and its wait is over, or when the round that took it vanished
// without settling it. Either way, only while attempts are left.
function waiting(projectId: string, now: number) {
  return and(
    eq(files.projectId, projectId),
    or(
      isNull(fileTexts.fileId),
      and(eq(fileTexts.status, 'failed'), lt(fileTexts.attempts, MAX_EXTRACTION_ATTEMPTS), sql`${fileTexts.indexedAt} <= ${now} - ${fileTexts.attempts} * ${RETRY_AFTER_MS}`),
      and(eq(fileTexts.status, 'extracting'), lt(fileTexts.attempts, MAX_EXTRACTION_ATTEMPTS), sql`${fileTexts.indexedAt} <= ${now - EXTRACTING_STALE_MS}`),
    ),
  );
}

// Indexes the files of a project that are waiting: documents after upload,
// files uploaded before search existed, and failed reads due for another try.
// Called when a project is opened and after an import, a bounded round at a
// time.
export async function indexPendingFiles(projectId: string) {
  const db = getDb();
  const now = Date.now();

  // A file whose every round died while reading it stops being taken, and
  // says so, instead of taking the round down each time it is opened.
  await db.update(fileTexts)
    .set({ status: 'failed', reason: `Reading this file did not finish after ${MAX_EXTRACTION_ATTEMPTS} attempts. It may be too large or complex to read here.` })
    .where(and(eq(fileTexts.projectId, projectId), eq(fileTexts.status, 'extracting'), sql`${fileTexts.attempts} >= ${MAX_EXTRACTION_ATTEMPTS}`, sql`${fileTexts.indexedAt} <= ${now - EXTRACTING_STALE_MS}`));

  const due = await db
    .select({ id: files.id, projectId: files.projectId, relativePath: files.relativePath, name: files.name, objectKey: files.objectKey, sizeBytes: files.sizeBytes })
    .from(files)
    .leftJoin(fileTexts, eq(fileTexts.fileId, files.id))
    .where(waiting(projectId, now))
    .limit(FILES_PER_ROUND);

  // Each file is taken, and its attempt counted, before it is read. If the
  // read kills the request, the attempt still counts.
  const claims = due.map((file) => db.insert(fileTexts)
    .values({ fileId: file.id, projectId: file.projectId, path: file.relativePath, content: '', status: 'extracting', attempts: 1, indexedAt: new Date(now) })
    .onConflictDoUpdate({ target: fileTexts.fileId, set: { status: 'extracting', attempts: sql`${fileTexts.attempts} + 1`, indexedAt: new Date(now) } }));
  // A file deleted meanwhile fails its foreign key; the others are still taken.
  if (claims.length) {
    try { await db.batch([claims[0], ...claims.slice(1)]); } catch { for (const claim of claims) await claim.catch(() => undefined); }
  }

  let failed = 0;
  const settled = [];
  for (const file of due) {
    let outcome: Outcome;
    try {
      outcome = outcomeOf(await trescPliku(file, rozszerzeniePliku(file.name)));
    } catch (error) {
      outcome = { status: 'failed', content: '', reason: `The file could not be read: ${error instanceof Error ? error.message : 'unknown error'}.` };
    }
    if (outcome.status === 'failed') failed += 1;
    const row = indexRow(file, outcome);
    settled.push(db.update(fileTexts).set({ content: row.content, status: row.status, reason: row.reason, indexedAt: row.indexedAt }).where(eq(fileTexts.fileId, file.id)));
  }
  if (settled.length) await db.batch([settled[0], ...settled.slice(1)]);

  const [{ value: remaining }] = await db
    .select({ value: count() })
    .from(files)
    .leftJoin(fileTexts, eq(fileTexts.fileId, files.id))
    .where(waiting(projectId, Date.now()));
  // Backfill passages in the same bounded rounds, without changing the
  // existing file-index counters or the response shape. While file extraction
  // is busy, take only one additional document to limit worker CPU time.
  let contextRemaining = 0;
  try {
    contextRemaining = (await indexPendingContextChunks(projectId, due.length ? 1 : 2)).remaining;
  } catch {
    // This derived index is optional for today's search and chat. A failed
    // chunk round must not hide the result of a successful file-text round.
    console.error('The optional context-chunk indexing round failed.');
  }
  return { indexed: due.length, failed, remaining: remaining + contextRemaining };
}
