// What an extraction result means for the search index, and what the files
// panel says about a file's text. No I/O, so the rules are tested on their own.

import type { WynikEkstrakcji } from './document-text';
import type { FileTextState } from './contracts/files';

// Reading a file is tried this many times before the index gives up on it.
export const MAX_EXTRACTION_ATTEMPTS = 3;
// A failed file waits this long, times the attempts made, before the next one.
export const RETRY_AFTER_MS = 5 * 60_000;
// A file still marked as being read after this long lost its round, most
// likely to the platform's CPU limit, and counts as a failed attempt.
export const EXTRACTING_STALE_MS = 2 * 60_000;

export type IndexStatus = 'extracting' | 'indexed' | 'unsupported' | 'failed';
export type Outcome = { status: 'indexed' | 'unsupported' | 'failed'; content: string; reason: string | null };

export function outcomeOf(result: WynikEkstrakcji): Outcome {
  if (result.blad) return { status: 'failed', content: '', reason: result.powod ?? 'The file could not be read.' };
  // Text with a reason is text with a note, such as a long PDF read only from
  // the beginning.
  if (result.tekst) return { status: 'indexed', content: result.tekst, reason: result.powod ?? null };
  if (result.powod) return { status: 'unsupported', content: '', reason: result.powod };
  // An empty text file has nothing to read and nothing wrong with it.
  return { status: 'indexed', content: '', reason: null };
}

type IndexRow = { status: IndexStatus; reason: string | null; attempts: number };

// The file's text as the files panel shows it. A file without an index row
// yet, or one being read, is pending.
export function fileTextState(row: IndexRow | null): FileTextState {
  if (!row || row.status === 'extracting') return { status: 'pending', note: null, retrying: false };
  if (row.status === 'failed') {
    // A row from before statuses existed, waiting for its first read.
    if (row.attempts === 0) return { status: 'pending', note: null, retrying: false };
    return { status: 'failed', note: row.reason, retrying: row.attempts < MAX_EXTRACTION_ATTEMPTS };
  }
  return { status: row.status, note: row.reason, retrying: false };
}
