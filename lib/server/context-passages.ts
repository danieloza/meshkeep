import 'server-only';

import { getDb } from '@/db';
import { type Chunk, chunkLocator, type Document, passageRuns, passagesText, selectPassages } from '@/lib/context-chunking';
import { CHUNK_EXTRACTOR_VERSION, chunksFromRows, type StoredChunk } from '@/lib/context-document';
import type { ContextPassage } from '@/lib/contracts/conversations';
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
      const locator = chunkLocator(chunk);
      passages.push({ ordinal: chunk.ordinal, chunkKey: keys[chunk.ordinal], ...(locator ? { locator } : {}), length });
      body += length;
      previous = chunk;
    }
    if (body !== run.body.length) throw new Error('The passage lengths of a run do not add up to its body.');
  }
  return { text: passagesText(document, selected), passages };
}

export type FilePassages =
  // `section` is what the provider receives under the file's `FILE:` line: the
  // note line, then the passages (`text`). The manifest's note is the same note.
  | { kind: 'passages'; section: string; text: string; passages: ContextPassage[]; note: string }
  // Current chunks exist, but the room left cannot hold the note and one passage.
  | { kind: 'none' }
  // No current chunks, or they cannot be read: the chat sends the file as before.
  | { kind: 'unavailable'; reason: string };

export type PassageNoteFacts = {
  count: number;
  total: number;
  // A passage matched the question; otherwise the beginning was sent.
  matched: boolean;
  // Only part of the file was indexed, so the rest could not be searched.
  partial: boolean;
  // What the extractor said about the file (`powod` of `trescPliku`).
  extractorNote?: string;
};

// What the model and the manifest are told about a file sent by passages: the
// same facts, in one line.
export function passageNote(facts: PassageNoteFacts): string {
  const sent = facts.matched
    ? `Passages of a longer file: ${facts.count} of ${facts.total}.`
    : `Passages of a longer file: no passage matched the question; the beginning of the file was sent (${facts.count} of ${facts.total}).`;
  const note = [sent, facts.partial ? 'The rest of the file could not be searched.' : null, facts.extractorNote ?? null].filter(Boolean).join(' ');
  // One line, whatever the extractor wrote.
  return note.replace(/\s+/g, ' ').trim();
}

// The note line as sent, `[note]` and its line end: what it costs the room.
const noteLine = (note: string) => `[${note}]\n`;

type Row = StoredChunk & { chunkCount: number; reason: string | null };

// `room` is what is left of the total for this file's text. The note line is
// paid from it, like the `FILE:` line is file metadata; the passages keep the
// simulation's allowance of `PER_FILE_PASSAGE_CHARS`, as far as the room left
// after the longest possible note allows.
export async function filePassages(file: { id: string; projectId: string; sha256: string }, question: string, room: number, extractorNote?: string): Promise<FilePassages> {
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
  // Step A records a reason with an indexed file only when it indexed part of it.
  const facts = { total: stored.length, partial: stored[0].reason !== null, extractorNote };
  // The note is known except for its count, and the count changes its length
  // only by its digits. Reserve the note for the most passages a given number
  // of digits allows, fewest digits (most room for passages) first, and take
  // the first choice whose own count fits that reservation. The last try, with
  // the digits of the total, always fits. So a file is left out only when not
  // even its actual note and one passage fit the room.
  const choose = (allowance: number) => (allowance <= 0 ? null : choosePassages(rebuilt.document, rebuilt.chunks,
    stored.map((row) => row.chunkKey), matched ? ranked : rebuilt.chunks.map((chunk) => chunk.ordinal), allowance));
  let choice: PassageChoice | null = null;
  for (let digits = 1; digits <= String(stored.length).length && !choice; digits += 1) {
    const most = Math.min(stored.length, 10 ** digits - 1);
    const candidate = choose(Math.min(PER_FILE_PASSAGE_CHARS, room - noteLine(passageNote({ ...facts, count: most, matched })).length));
    // Less room cannot fit what more room did not.
    if (!candidate) break;
    if (candidate.passages.length <= most) choice = candidate;
  }
  if (!choice) return { kind: 'none' };
  const note = passageNote({ ...facts, count: choice.passages.length, matched });
  return { kind: 'passages', section: noteLine(note) + choice.text, text: choice.text, passages: choice.passages, note };
}
