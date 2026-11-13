import 'server-only';

import { env } from 'cloudflare:workers';
import { getDocumentProxy } from 'unpdf';
import { contextDocument, limitContextText, limitPdfPages, MAX_CHUNK_PDF_CHARS, type ChunkFile } from '@/lib/context-document';
import type { Document } from '@/lib/context-chunking';
import { jestZwyklymTekstem, MAX_CONTEXT_FILE_BYTES, MAX_DOCUMENT_BYTES, rozszerzeniePliku, trescPliku } from './file-text';

type ContextFile = ChunkFile & { name: string; objectKey: string; sizeBytes: number };
type Result = { document: Document | null; reason: string | null; failed: boolean };
const MAX_ARCHIVE_BYTES = 1_000_000;
const MAX_ARCHIVE_ENTRIES = 2_000;
const MAX_PDF_PAGES = 40;

// PDF.js exposes a stream of text items. Read pages one at a time and stop
// collecting at the character/page budget instead of materializing every page.
async function readPdfPages(bytes: Uint8Array<ArrayBuffer>): Promise<{ pages: string[]; truncated: boolean }> {
  const pdf = await getDocumentProxy(bytes);
  const pages: string[] = [];
  let used = 0;
  let truncated = pdf.numPages > MAX_PDF_PAGES;
  for (let number = 1; number <= Math.min(pdf.numPages, MAX_PDF_PAGES); number += 1) {
    const page = await pdf.getPage(number);
    const reader = page.streamTextContent().getReader();
    const parts: string[] = [];
    let stop = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const item of value.items) {
          if (!('str' in item)) continue;
          const text = item.str + (item.hasEOL ? '\n' : '');
          const room = Math.max(0, MAX_CHUNK_PDF_CHARS + 1 - used);
          parts.push(text.slice(0, room));
          used += Math.min(text.length, room);
          if (text.length > room || used > MAX_CHUNK_PDF_CHARS) { stop = true; truncated = true; break; }
        }
        if (stop) { await reader.cancel().catch(() => undefined); break; }
      }
    } finally {
      reader.releaseLock();
      page.cleanup();
    }
    pages.push(parts.join(''));
    if (stop) break;
  }
  return { pages, truncated };
}

// This background-only reader never changes the existing file-text or chat
// extraction. It reads PDF pages separately to retain real page locators.
export async function readContextDocument(file: ContextFile): Promise<Result> {
  try {
    const extension = rozszerzeniePliku(file.name);
    const limit = jestZwyklymTekstem(extension) ? MAX_CONTEXT_FILE_BYTES : MAX_DOCUMENT_BYTES;
    if (file.sizeBytes > limit) return { document: null, reason: `The file exceeds the ${Math.round(limit / 1000)} kB limit for this type.`, failed: false };
    const object = await env.FILES.get(file.objectKey);
    if (!object) return { document: null, reason: 'The file is no longer in storage.', failed: true };
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (extension === 'pdf') {
      const read = await readPdfPages(bytes);
      const limited = limitPdfPages(read.pages);
      const document = contextDocument('pdf', '', limited.pages);
      if (!document.text) return { document: null, reason: read.truncated
        ? 'No readable text was found in the pages examined; later pages were not indexed.'
        : 'This PDF has no readable text layer.', failed: false };
      return { document, reason: read.truncated || limited.truncated ? 'Only the beginning of this PDF was indexed for passages.' : null, failed: false };
    }
    if (extension === 'rtf' && bytes.byteLength > MAX_ARCHIVE_BYTES) return { document: null, reason: 'This RTF exceeds the safe passage-indexing limit.', failed: false };
    const result = await trescPliku(file, extension, bytes, { maxArchiveBytes: MAX_ARCHIVE_BYTES, maxArchiveEntries: MAX_ARCHIVE_ENTRIES, maxOutputChars: 120_000 });
    if (result.blad) return { document: null, reason: result.powod ?? 'The file could not be read.', failed: true };
    if (!result.tekst && result.powod) return { document: null, reason: result.powod, failed: false };
    const limited = limitContextText(result.tekst);
    const reason = [result.powod, limited.truncated ? 'Only the beginning of this file was indexed for passages.' : null].filter(Boolean).join(' ') || null;
    return { document: contextDocument(extension, limited.text), reason, failed: false };
  } catch (error) {
    return { document: null, reason: `The file could not be read: ${error instanceof Error ? error.message : 'unknown error'}.`, failed: true };
  }
}
