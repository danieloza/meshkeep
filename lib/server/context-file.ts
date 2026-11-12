import 'server-only';

import { env } from 'cloudflare:workers';
import { extractText, getDocumentProxy } from 'unpdf';
import { contextDocument, limitPdfPages, type ChunkFile } from '@/lib/context-document';
import type { Document } from '@/lib/context-chunking';
import { jestZwyklymTekstem, MAX_CONTEXT_FILE_BYTES, MAX_DOCUMENT_BYTES, rozszerzeniePliku, trescPliku } from './file-text';

type ContextFile = ChunkFile & { name: string; objectKey: string; sizeBytes: number };
type Result = { document: Document | null; reason: string | null; failed: boolean };

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
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: false });
      const limited = limitPdfPages(text);
      const document = contextDocument('pdf', '', limited.pages);
      if (!document.text) return { document: null, reason: 'This PDF has no readable text layer.', failed: false };
      return { document, reason: limited.truncated ? 'Only the beginning of this PDF was indexed for passages.' : null, failed: false };
    }
    const result = await trescPliku(file, extension, bytes);
    if (result.blad) return { document: null, reason: result.powod ?? 'The file could not be read.', failed: true };
    if (!result.tekst && result.powod) return { document: null, reason: result.powod, failed: false };
    return { document: contextDocument(extension, result.tekst), reason: result.powod ?? null, failed: false };
  } catch (error) {
    return { document: null, reason: `The file could not be read: ${error instanceof Error ? error.message : 'unknown error'}.`, failed: true };
  }
}
