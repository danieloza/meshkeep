import { canonicalText, chunksOf, lineUnits, markdownUnits, paragraphUnits, passageLabel, passageSearchLabel, pdfDocument, sheetUnits, type Document } from './context-chunking';

// This version is part of every stamp. Change it when extraction or chunk
// boundaries change, so a saved citation cannot resolve to different text.
export const CHUNK_EXTRACTOR_VERSION = '1';
export const MAX_FILE_CHUNKS = 600;
export const MAX_CHUNK_PDF_CHARS = 120_000;

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

export async function buildContextChunks(file: ChunkFile, document: Document): Promise<{ rows: ChunkRow[]; truncated: boolean }> {
  const chunks = chunksOf(document, true);
  const rows = await Promise.all(chunks.slice(0, MAX_FILE_CHUNKS).map(async (chunk) => ({
    fileId: file.id,
    projectId: file.projectId,
    path: file.relativePath,
    ordinal: chunk.ordinal,
    chunkKey: await chunkStamp(file.sha256, chunk.ordinal),
    startChar: chunk.start,
    endChar: chunk.end,
    content: chunk.text,
    label: passageLabel(chunk),
    searchLabel: passageSearchLabel(chunk),
    place: chunk.place,
    heading: chunk.heading,
    headerCut: chunk.headerCut ? 1 : 0,
  })));
  return { rows, truncated: chunks.length > MAX_FILE_CHUNKS };
}
