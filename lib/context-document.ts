import { canonicalText, type Chunk, CHUNK_RULE, chunksOf, lineUnits, markdownUnits, paragraphUnits, passageLabel, passageSearchLabel, pdfDocument, safeHeader, sheetUnits, type Document } from './context-chunking';

// This version is part of every stamp. Change it when extraction or chunk
// boundaries change, or what a stored chunk holds, so a saved citation cannot
// resolve to different text.
//   1: `content` was the chunk's own slice.
//   2: `content` also carries the text between the previous chunk and this one
//      (its leading gap), so the chat can send the exact span of consecutive
//      chunks without the document.
export const CHUNK_EXTRACTOR_VERSION = '2';
export const MAX_FILE_CHUNKS = 600;
export const MAX_CHUNK_PDF_CHARS = 120_000;
export const MAX_CHUNK_TEXT_CHARS = 120_000;

export function limitContextText(text: string, limit = MAX_CHUNK_TEXT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  let end = Math.max(0, limit);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), truncated: true };
}

export type ChunkFile = { id: string; projectId: string; relativePath: string; sha256: string };
export type ChunkRow = {
  fileId: string;
  projectId: string;
  path: string;
  ordinal: number;
  chunkKey: string;
  startChar: number;
  endChar: number;
  content: string;
  label: string;
  searchLabel: string;
  place: string;
  heading: string;
  headerCut: number;
};

// Bound stored PDF text before chunking. Keep page positions, including empty
// pages, and do not cut between the halves of a supplementary character.
export function limitPdfPages(pages: string[], limit = MAX_CHUNK_PDF_CHARS): { pages: string[]; truncated: boolean } {
  let used = 0;
  let prior = false;
  let truncated = false;
  let stopped = false;
  const limited = pages.map((value) => {
    const page = canonicalText(value).replaceAll('\u00a0', ' ').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!page) return '';
    if (stopped) { truncated = true; return ''; }
    const separator = prior ? 2 : 0;
    const room = Math.max(0, limit - used - separator);
    let end = Math.min(room, page.length);
    if (end < page.length && end > 0) {
      const last = page.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    }
    if (end < page.length) { truncated = true; stopped = true; }
    if (!end) return '';
    used += separator + end;
    prior = true;
    return page.slice(0, end);
  });
  return { pages: limited, truncated };
}

// The ordinary extractor's text is used for every format except PDF. A PDF
// must supply individually extracted pages: guessing a page from merged text
// would make a citation's locator untrustworthy.
export function contextDocument(extension: string, extracted: string, pages?: string[]): Document {
  const kind = extension.toLowerCase();
  if (kind === 'pdf') {
    if (!pages) throw new Error('PDF chunks require individually extracted pages.');
    return pdfDocument(pages);
  }
  const text = canonicalText(extracted);
  const units = kind === 'md' ? markdownUnits(text)
    : kind === 'xlsx' ? sheetUnits(text)
      : kind === 'docx' ? lineUnits(text)
        : paragraphUnits(text);
  return { text, units };
}

async function chunkStamp(fileSha: string, ordinal: number): Promise<string> {
  const bytes = new TextEncoder().encode(`${fileSha}:${CHUNK_EXTRACTOR_VERSION}:${ordinal}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

// `content` holds the chunk's slice and, before it, the text since the end of
// the previous chunk (whitespace with today's units, which never touch). The
// first chunk starts at its first unit. `startChar` still marks the slice, so
// the gap is `content.length - (endChar - startChar)`.
export async function buildContextChunks(file: ChunkFile, document: Document): Promise<{ rows: ChunkRow[]; truncated: boolean }> {
  const chunks = chunksOf(document, true);
  const rows = await Promise.all(chunks.slice(0, MAX_FILE_CHUNKS).map(async (chunk, index) => ({
    fileId: file.id,
    projectId: file.projectId,
    path: file.relativePath,
    ordinal: chunk.ordinal,
    chunkKey: await chunkStamp(file.sha256, chunk.ordinal),
    startChar: chunk.start,
    endChar: chunk.end,
    content: document.text.slice(index === 0 ? chunk.start : chunks[index - 1].end, chunk.end),
    label: passageLabel(chunk),
    searchLabel: passageSearchLabel(chunk),
    place: chunk.place,
    heading: chunk.heading,
    headerCut: chunk.headerCut ? 1 : 0,
  })));
  return { rows, truncated: chunks.length > MAX_FILE_CHUNKS };
}

// What the chat reads back from `file_chunks` for one file.
export type StoredChunk = Pick<ChunkRow, 'ordinal' | 'chunkKey' | 'startChar' | 'endChar' | 'content' | 'label' | 'searchLabel' | 'place' | 'heading' | 'headerCut'>;

// A sheet's full header row is the end of the search label, after the place
// and the headings (`passageSearchLabel`). `null`: the label does not fit.
function storedHeader(row: StoredChunk): string | undefined | null {
  const prefix = [row.place, row.heading].filter(Boolean).join(' ');
  if (row.searchLabel === prefix) return undefined;
  const lead = prefix ? `${prefix} ` : '';
  return row.searchLabel.startsWith(lead) && row.searchLabel.length > lead.length ? row.searchLabel.slice(lead.length) : null;
}

// The inverse of `buildContextChunks`, for all stored chunks of one file in
// ordinal order: the chunks as `chunksOf` made them, and the file's text from
// the first chunk to the last, which is all `passagesText` reads. Text before
// the first chunk is not stored; spaces stand in for it, and no passage
// reaches them. Rows that do not fit together give a reason instead, so the
// chat can send the file as before rather than send a wrong span.
export function chunksFromRows(rows: StoredChunk[]): { document: Document; chunks: Chunk[] } | { failure: string } {
  if (!rows.length) return { failure: 'No chunks are stored.' };
  const chunks: Chunk[] = [];
  for (const [index, row] of rows.entries()) {
    const previousEnd = index === 0 ? row.startChar : rows[index - 1].endChar;
    if (row.ordinal !== index) return { failure: 'The stored chunks are not contiguous.' };
    if (!Number.isInteger(row.startChar) || !Number.isInteger(row.endChar) || row.startChar < previousEnd || row.endChar <= row.startChar
      || row.content.length !== row.endChar - previousEnd) {
      return { failure: 'A stored chunk does not match its offsets.' };
    }
    const searchHeader = storedHeader(row);
    if (searchHeader === null) return { failure: 'A stored chunk label does not match its place.' };
    const gap = row.startChar - previousEnd;
    const chunk: Chunk = {
      ordinal: row.ordinal,
      start: row.startChar,
      end: row.endChar,
      text: row.content.slice(gap),
      place: row.place,
      heading: row.heading,
      // Units never touch, so only the pieces of a cut unit leave no gap.
      continuesPrevious: index > 0 && gap === 0,
      ...(searchHeader === undefined ? {} : {
        header: safeHeader(searchHeader, CHUNK_RULE.headerChars),
        searchHeader,
        ...(searchHeader.length > CHUNK_RULE.headerChars ? { headerCut: true } : {}),
      }),
    };
    if (passageLabel(chunk) !== row.label || (chunk.headerCut ? 1 : 0) !== row.headerCut) {
      return { failure: 'A stored chunk label does not match its place.' };
    }
    chunks.push(chunk);
  }
  return { document: { text: ' '.repeat(rows[0].startChar) + rows.map((row) => row.content).join(''), units: [] }, chunks };
}
