import 'server-only';

import { getDb } from '@/db';
import { type Chunk, type Document, passageRuns, passagesText, selectPassages } from '@/lib/context-chunking';
import { CHUNK_EXTRACTOR_VERSION, chunksFromRows, type StoredChunk } from '@/lib/context-document';
import type { ContextPassage, PassageLocator } from '@/lib/contracts/conversations';
import { buildSuggestQuery } from '@/lib/search';

// ADR 0001, decision 0: a file whose extracted text is at most this long is
// sent whole, as before; a longer one sends its best passages, up to the
// second number. Both were set before the first measurement and stay untuned.
export const WHOLE_FILE_CHARS = 6_000;
export const PER_FILE_PASSAGE_CHARS = 6_000;
export function needsPassages(extracted: string): boolean {
  return extracted.length > WHOLE_FILE_CHARS;
}
// As many candidates as the simulation ranks per file.
const PASSAGE_CANDIDATES = 40;
// As much of the question as `suggest-files` reads.
const QUESTION_CHARS = 2_000;

// Chunks count only while they belong to the file as it is now: indexed for
// these bytes, by this extractor, in the file's own project. Every read below
// carries this fence, so a stale, failed or foreign chunk never takes part.
const CURRENT = `EXISTS (SELECT 1 FROM file_chunk_states s JOIN files f ON f.id = s.file_id
  WHERE s.file_id = c.file_id AND s.project_id = c.project_id AND f.project_id = c.project_id
    AND s.status = 'indexed' AND f.sha256 = ? AND s.file_sha = f.sha256 AND s.extractor_version = ?)`;

// Ranked inside one file of one project (decision 6). Weights as the
// simulation's "files, then passages": path 4, search label 2, content 1. The
// display label is a shortened copy of the search label: it gets no weight
// and is left out of the match, so no chunk becomes a candidate through it.
const RANKED = `SELECT c.ordinal AS ordinal FROM file_chunks_fts JOIN file_chunks c ON c.rowid = file_chunks_fts.rowid
  WHERE file_chunks_fts MATCH ? AND c.project_id = ? AND c.file_id = ? AND ${CURRENT}
  ORDER BY bm25(file_chunks_fts, 4.0, 0.0, 2.0, 1.0), c.ordinal LIMIT ${PASSAGE_CANDIDATES}`;

// Every chunk of the file: the sender rebuilds the exact spans from them.
// Step A bounds a file to 600 chunks and 120 000 characters.
const ROWS = `SELECT c.ordinal AS ordinal, c.chunk_key AS chunkKey, c.start_char AS startChar, c.end_char AS endChar,
    c.content AS content, c.label AS label, c.search_label AS searchLabel, c.place AS place, c.heading AS heading,
    c.header_cut AS headerCut, s.chunk_count AS chunkCount, s.reason AS reason
  FROM file_chunks c JOIN file_chunk_states s ON s.file_id = c.file_id
  WHERE c.project_id = ? AND c.file_id = ? AND ${CURRENT}
  ORDER BY c.ordinal`;

// Search the columns that the simulation searches, and only them.
export function passageMatch(question: string): string | null {
  const match = buildSuggestQuery(question.slice(0, QUESTION_CHARS));
  return match ? `{path search_label content} : (${match})` : null;
}

export function locatorOf(chunk: Pick<Chunk, 'place' | 'heading'>): PassageLocator | undefined {
  const place = chunk.place.match(/^(page|sheet) (\d+)$/);
  if (place) return place[1] === 'page' ? { page: Number(place[2]) } : { sheet: Number(place[2]) };
  return chunk.heading ? { heading: chunk.heading } : undefined;
}

export type PassageChoice = { text: string; passages: ContextPassage[] };

// The shared rule chooses (`selectPassages`) and writes (`passagesText`) what
// a long file sends; the manifest gets one entry per chosen chunk. `null`:
// nothing fits the allowance.
export function choosePassages(document: Document, chunks: Chunk[], keys: string[], ranked: number[], allowance: number): PassageChoice | null {
  const ordinals = selectPassages(document, chunks, ranked, allowance);
  if (!ordinals.length) return null;
  const selected = ordinals.map((ordinal) => chunks[ordinal]);
  const passages: ContextPassage[] = [];
  for (const run of passageRuns(document, selected)) {
    let previous: Chunk | null = null;
    let body = 0;
    for (const chunk of selected.filter((item) => item.ordinal >= run.first.ordinal && item.ordinal <= run.last.ordinal)) {
      const length = chunk.end - (previous ? previous.end : chunk.start);
      const locator = locatorOf(chunk);
      passages.push({ ordinal: chunk.ordinal, chunkKey: keys[chunk.ordinal], ...(locator ? { locator } : {}), length });
      body += length;
      previous = chunk;
    }
    if (body !== run.body.length) throw new Error('The passage lengths of a run do not add up to its body.');
  }
  return { text: passagesText(document, selected), passages };
}

export type FilePassages =
  | { kind: 'passages'; text: string; passages: ContextPassage[]; note: string }
  // Current chunks exist, but not even one fits the room left.
  | { kind: 'none' }
  // No current chunks, or they cannot be read: the chat sends the file as before.
  | { kind: 'unavailable'; reason: string };

type Row = StoredChunk & { chunkCount: number; reason: string | null };

export async function filePassages(file: { id: string; projectId: string; sha256: string }, question: string, allowance: number): Promise<FilePassages> {
  const db = getDb().$client;
  const match = passageMatch(question);
  const fence = [file.sha256, CHUNK_EXTRACTOR_VERSION];
  const rows = db.prepare(ROWS).bind(file.projectId, file.id, ...fence);
  // One batch: the ranking and the rows see the same state of the index.
  const results = await db.batch(match ? [db.prepare(RANKED).bind(match, file.projectId, file.id, ...fence), rows] : [rows]);
  const ranked = match ? (results[0].results as Array<{ ordinal: number }>).map((row) => Number(row.ordinal)) : [];
  const stored = (results.at(-1)!.results as Row[]).map((row) => ({
    ...row,
    ordinal: Number(row.ordinal), startChar: Number(row.startChar), endChar: Number(row.endChar), headerCut: Number(row.headerCut),
  }));
  if (!stored.length) return { kind: 'unavailable', reason: 'The file has no current chunks.' };
  if (stored.length !== Number(stored[0].chunkCount)) return { kind: 'unavailable', reason: 'The stored chunks are incomplete.' };
  const rebuilt = chunksFromRows(stored);
  if ('failure' in rebuilt) return { kind: 'unavailable', reason: rebuilt.failure };

  // No passage matched: the beginning of the file, by the same rule. The
  // server cannot tell a file the member attached on purpose from one Auto
  // suggested, and an attached file must not arrive empty.
  const matched = ranked.length > 0;
  const choice = choosePassages(rebuilt.document, rebuilt.chunks, stored.map((row) => row.chunkKey),
    matched ? ranked : rebuilt.chunks.map((chunk) => chunk.ordinal), allowance);
  if (!choice) return { kind: 'none' };
  // Step A records a reason with an indexed file only when it indexed part of it.
  const note = [
    matched ? `${choice.passages.length} of ${stored.length} passages.` : 'No passage matched the question; the beginning of the file was sent.',
    stored[0].reason === null ? null : 'The rest of the file could not be searched.',
  ].filter(Boolean).join(' ');
  return { kind: 'passages', text: choice.text, passages: choice.passages, note };
}
