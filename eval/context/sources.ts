// A source file of an evaluation set as the application's passage indexer
// reads it (`readContextDocument` in `lib/server/context-file.ts`, which runs
// only in the Worker): the same extractors, the same limits and the same
// document builder, then the shared chunking rule. The runner checks every
// passage the chat sent against this, so the limits matter: a partly indexed
// file is compared with the part that was indexed.
//
// Only erasable TypeScript. Node runs this file as it is.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extractText, getDocumentProxy } from 'unpdf';
import { type Chunk, chunksOf, type Document } from './chunking.ts';
import { CHUNK_EXTRACTOR_VERSION, contextDocument, limitContextText, limitPdfPages, MAX_FILE_CHUNKS } from '../../lib/context-document.ts';
import { wydobadzTekstDokumentu } from '../../lib/document-text.ts';

// As `lib/server/context-file.ts` and `lib/server/file-text.ts` set them.
const MAX_PDF_PAGES = 40;
const ARCHIVE_LIMITS = { maxArchiveBytes: 1_000_000, maxArchiveEntries: 2_000, maxOutputChars: 120_000 };
// `TEXT_CONTEXT_EXTENSIONS`: read as text; every other type goes through the extractor.
const PLAIN_TEXT = new Set([
  'txt', 'md', 'json', 'csv', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py',
  'go', 'rs', 'java', 'kt', 'swift', 'css', 'scss', 'html', 'xml', 'yaml',
  'yml', 'toml', 'sql', 'sh', 'ps1', 'bat',
]);

function bytesOf(path: string): Uint8Array<ArrayBuffer> {
  const buffer = readFileSync(path);
  return new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
}

export async function sourceDocument(path: string): Promise<Document> {
  const extension = path.split('.').pop()!.toLowerCase();
  if (extension === 'pdf') {
    const { text } = await extractText(await getDocumentProxy(bytesOf(path)), { mergePages: false });
    return contextDocument('pdf', '', limitPdfPages(text.slice(0, MAX_PDF_PAGES)).pages);
  }
  const extracted = PLAIN_TEXT.has(extension)
    ? new TextDecoder().decode(bytesOf(path)).replaceAll('\0', '')
    : (await wydobadzTekstDokumentu(extension, bytesOf(path), ARCHIVE_LIMITS)).tekst;
  return contextDocument(extension, limitContextText(extracted).text);
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

// The document and the chunks the indexer stores for it, ordinal by ordinal,
// with each chunk's stamp: the first 20 hex characters of
// `sha256(file SHA-256 + ":" + extractor version + ":" + ordinal)` (ADR 0001,
// decision 1), from the file's own bytes.
export async function sourceChunks(path: string): Promise<{ document: Document; chunks: Chunk[]; keys: string[] }> {
  const document = await sourceDocument(path);
  const chunks = chunksOf(document, true).slice(0, MAX_FILE_CHUNKS);
  const fileSha = sha256(bytesOf(path));
  return { document, chunks, keys: chunks.map((chunk) => sha256(`${fileSha}:${CHUNK_EXTRACTOR_VERSION}:${chunk.ordinal}`).slice(0, 20)) };
}
