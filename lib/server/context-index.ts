import 'server-only';

import { getDb } from '@/db';
import { buildContextChunks, CHUNK_EXTRACTOR_VERSION } from '@/lib/context-document';
import { readContextDocument } from '@/lib/server/context-file';

const FILES_PER_ROUND = 5;
const MAX_ATTEMPTS = 3;
const RETRY_MS = 5 * 60_000;
const LEASE_MS = 2 * 60_000;
const MAX_FILE_CHUNKS = 600;
// Refuse rather than truncate a searchable label: otherwise its tail silently
// disappears from FTS. Both limits count UTF-8 bytes, including repeated labels.
const MAX_SEARCH_LABEL_BYTES = 64 * 1024;
const MAX_ROW_TEXT_BYTES = 1024 * 1024;
const MAX_BATCH_TEXT_BYTES = 4 * 1024 * 1024;
const ROWS_PER_STATEMENT = 6; // 6 * 13 row parameters + 10 lease parameters < D1's 100.

type ContextFile = {
  id: string; projectId: string; relativePath: string; name: string;
  objectKey: string; sizeBytes: number; sha256: string;
};
type ChunkRow = {
  fileId: string; projectId: string; path: string; ordinal: number; chunkKey: string;
  startChar: number; endChar: number; content: string; label: string; searchLabel: string;
  place: string; heading: string; headerCut: number;
};

// Both selection and claim use this condition. Claim repeats it inside its
// single atomic INSERT/UPSERT, so a concurrent selector cannot steal a lease.
const due = `(s.file_id IS NULL OR s.project_id <> f.project_id OR s.file_sha <> f.sha256 OR s.extractor_version <> ?
  OR (s.status = 'failed' AND s.attempts < ? AND s.indexed_at + s.attempts * ? <= ?)
  OR (s.status = 'indexing' AND s.attempts < ? AND s.claimed_at <= ?))`;
const dueArgs = (now: number) => [CHUNK_EXTRACTOR_VERSION, MAX_ATTEMPTS, RETRY_MS, now, MAX_ATTEMPTS, now - LEASE_MS];

// This predicate fences *every* mutation, including the first DELETE in the
// transaction. It also rejects expired leases and files changed during I/O.
const active = `SELECT 1 FROM file_chunk_states s
  JOIN files f ON f.id = s.file_id
  JOIN file_texts t ON t.file_id = f.id AND t.project_id = f.project_id
  WHERE s.file_id = ? AND s.project_id = ? AND s.file_sha = ? AND s.extractor_version = ?
    AND s.status = 'indexing' AND s.lease_id = ? AND s.claimed_at > ?
    AND f.project_id = s.project_id AND f.sha256 = s.file_sha AND f.relative_path = ? AND f.object_key = ?
    AND f.name = ? AND f.size_bytes = ?
    AND t.status = 'indexed'`;
const activeArgs = (file: ContextFile, lease: string, now: number) => [
  file.id, file.projectId, file.sha256, CHUNK_EXTRACTOR_VERSION, lease, now - LEASE_MS,
  file.relativePath, file.objectKey, file.name, file.sizeBytes,
];

function validateRows(file: ContextFile, rows: ChunkRow[]) {
  if (rows.length > MAX_FILE_CHUNKS) throw new Error(`Chunk limit exceeded (${MAX_FILE_CHUNKS}).`);
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const [ordinal, row] of rows.entries()) {
    if (row.fileId !== file.id || row.projectId !== file.projectId || row.path !== file.relativePath || row.ordinal !== ordinal) {
      throw new Error('Chunk identity or ordinal does not match its file.');
    }
    const strings = [row.fileId, row.projectId, row.path, row.chunkKey, row.content, row.label, row.searchLabel, row.place, row.heading];
    if (strings.some((value) => typeof value !== 'string') || !Number.isInteger(row.startChar) || !Number.isInteger(row.endChar)
      || row.startChar < 0 || row.endChar < row.startChar || ![0, 1].includes(row.headerCut)) {
      throw new Error('Invalid chunk fields.');
    }
    if (encoder.encode(row.searchLabel).length > MAX_SEARCH_LABEL_BYTES) {
      throw new Error(`Full searchable label exceeds ${MAX_SEARCH_LABEL_BYTES} UTF-8 bytes.`);
    }
    const rowBytes = strings.reduce((total, value) => total + encoder.encode(value).length, 0);
    if (rowBytes > MAX_ROW_TEXT_BYTES) throw new Error(`Chunk text exceeds ${MAX_ROW_TEXT_BYTES} UTF-8 bytes per row.`);
    bytes += rowBytes;
    if (bytes > MAX_BATCH_TEXT_BYTES) throw new Error(`Chunk text exceeds ${MAX_BATCH_TEXT_BYTES} UTF-8 bytes per file.`);
  }
}

const chunkColumns = 'file_id, project_id, path, ordinal, chunk_key, start_char, end_char, content, label, search_label, place, heading, header_cut';
const chunkValues = (row: ChunkRow) => [row.fileId, row.projectId, row.path, row.ordinal, row.chunkKey,
  row.startChar, row.endChar, row.content, row.label, row.searchLabel, row.place, row.heading, row.headerCut];

type Client = ReturnType<typeof getDb>['$client'];

async function claim(db: Client, file: ContextFile, now: number, lease: string) {
  const take = db.prepare(`INSERT INTO file_chunk_states
    (file_id, project_id, file_sha, extractor_version, status, attempts, lease_id, claimed_at, chunk_count, reason, indexed_at)
    SELECT f.id, f.project_id, f.sha256, ?, 'indexing',
      CASE WHEN s.project_id = f.project_id AND s.file_sha = f.sha256 AND s.extractor_version = ? THEN s.attempts + 1 ELSE 1 END,
      ?, ?, 0, NULL, 0
    FROM files f JOIN file_texts t ON t.file_id = f.id AND t.project_id = f.project_id
    LEFT JOIN file_chunk_states s ON s.file_id = f.id
    WHERE f.id = ? AND f.project_id = ? AND f.sha256 = ? AND f.object_key = ? AND f.relative_path = ?
      AND f.name = ? AND f.size_bytes = ?
      AND t.status = 'indexed' AND ${due}
    ON CONFLICT(file_id) DO UPDATE SET project_id=excluded.project_id, file_sha=excluded.file_sha,
      extractor_version=excluded.extractor_version, status='indexing', attempts=excluded.attempts,
      lease_id=excluded.lease_id, claimed_at=excluded.claimed_at, chunk_count=0, reason=NULL, indexed_at=0`)
    .bind(CHUNK_EXTRACTOR_VERSION, CHUNK_EXTRACTOR_VERSION, lease, now,
      file.id, file.projectId, file.sha256, file.objectKey, file.relativePath, file.name, file.sizeBytes, ...dueArgs(now));
  // Invalidate any previous index together with the claim, so an old FTS row
  // cannot be returned while a new version is indexing or has failed. The
  // unique lease fences the delete if another contender won the claim.
  const invalidate = db.prepare(`DELETE FROM file_chunks WHERE file_id = ? AND EXISTS (${active})`)
    .bind(file.id, ...activeArgs(file, lease, now));
  const [result] = await db.batch([take, invalidate]);
  return result.meta.changes === 1;
}

async function settle(db: Client, file: ContextFile, lease: string, status: 'indexed' | 'unsupported' | 'failed', reason: string | null, rows: ChunkRow[]) {
  const now = Date.now();
  const fence = activeArgs(file, lease, now);
  const statements: D1PreparedStatement[] = [];
  if (status !== 'failed') {
    statements.push(db.prepare(`DELETE FROM file_chunks WHERE file_id = ? AND EXISTS (${active})`).bind(file.id, ...fence));
    for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
      const group = rows.slice(i, i + ROWS_PER_STATEMENT);
      const tuples = group.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
      statements.push(db.prepare(`WITH payload(${chunkColumns}) AS (VALUES ${tuples})
        INSERT INTO file_chunks (${chunkColumns}) SELECT * FROM payload WHERE EXISTS (${active})`)
        .bind(...group.flatMap(chunkValues), ...fence));
    }
  }
  statements.push(db.prepare(`UPDATE file_chunk_states SET status = ?, lease_id = NULL, chunk_count = ?, reason = ?, indexed_at = ?
    WHERE file_id = ? AND EXISTS (${active})`)
    .bind(status, status === 'failed' ? 0 : rows.length, reason, now, file.id, ...fence));
  // D1 batch is transactional: a failed insert rolls back the preceding delete.
  const results = await db.batch(statements);
  return results[results.length - 1].meta.changes === 1;
}

// Returns claims processed, failures settled by this round, and all retryable
// work still outstanding (including delayed retries and currently held leases).
export async function indexPendingContextChunks(projectId: string): Promise<{ processed: number; failed: number; remaining: number }> {
  const db = getDb().$client;
  const now = Date.now();
  // A dead last attempt cannot retain an indexing lease forever.
  await db.prepare(`UPDATE file_chunk_states SET status='failed', lease_id=NULL, indexed_at=?,
    reason='Indexing did not finish before the lease expired.'
    WHERE project_id=? AND status='indexing' AND attempts>=? AND claimed_at<=?
      AND EXISTS (SELECT 1 FROM files f WHERE f.id=file_chunk_states.file_id AND f.project_id=?
        AND f.sha256=file_chunk_states.file_sha AND file_chunk_states.extractor_version=?)`)
    .bind(now, projectId, MAX_ATTEMPTS, now - LEASE_MS, projectId, CHUNK_EXTRACTOR_VERSION).run();
  const candidates = await db.prepare(`SELECT f.id, f.project_id AS projectId, f.relative_path AS relativePath,
    f.name, f.object_key AS objectKey, f.size_bytes AS sizeBytes, f.sha256
    FROM files f JOIN file_texts t ON t.file_id=f.id AND t.project_id=f.project_id
    LEFT JOIN file_chunk_states s ON s.file_id=f.id
    WHERE f.project_id=? AND t.status='indexed' AND ${due} ORDER BY f.id LIMIT ?`)
    .bind(projectId, ...dueArgs(now), FILES_PER_ROUND).all<ContextFile>();
  let processed = 0;
  let failed = 0;
  for (const file of candidates.results) {
    const lease = crypto.randomUUID();
    if (!await claim(db, file, Date.now(), lease)) continue;
    processed += 1;
    try {
      const result = await readContextDocument(file);
      if (result.failed) {
        if (await settle(db, file, lease, 'failed', result.reason ?? 'The document could not be read.', [])) failed += 1;
      } else if (!result.document) {
        await settle(db, file, lease, 'unsupported', result.reason, []);
      } else {
        const built = buildContextChunks(file, result.document);
        validateRows(file, built.rows);
        const reason = [result.reason, built.truncated ? 'Only part of the document was indexed.' : null].filter(Boolean).join(' ') || null;
        await settle(db, file, lease, 'indexed', reason, built.rows);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 1000) : 'The document could not be indexed.';
      if (await settle(db, file, lease, 'failed', reason, [])) failed += 1;
    }
  }
  const pending = await db.prepare(`SELECT COUNT(*) AS n FROM files f
    JOIN file_texts t ON t.file_id=f.id AND t.project_id=f.project_id
    LEFT JOIN file_chunk_states s ON s.file_id=f.id
    WHERE f.project_id=? AND t.status='indexed' AND (s.file_id IS NULL OR s.project_id<>f.project_id OR s.file_sha<>f.sha256 OR s.extractor_version<>?
      OR (s.status='failed' AND s.attempts<?) OR s.status='indexing')`)
    .bind(projectId, CHUNK_EXTRACTOR_VERSION, MAX_ATTEMPTS).first<{ n: number }>();
  return { processed, failed, remaining: pending?.n ?? 0 };
}
