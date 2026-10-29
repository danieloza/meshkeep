// GET /api/search. See `common.ts` for how the contracts are used, and
// `lib/search.ts` for how the query and the highlights are built.

import { z } from 'zod';
import { id } from './common';

export const conversationHit = z.object({
  conversationId: id,
  projectId: id,
  projectName: z.string(),
  title: z.string(),
  role: z.string(),
  snippet: z.string(),
});
export type ConversationHit = z.infer<typeof conversationHit>;

export const fileHit = z.object({
  fileId: id,
  projectId: id,
  projectName: z.string(),
  path: z.string(),
  snippet: z.string(),
});
export type FileHit = z.infer<typeof fileHit>;

// `unindexedFiles` counts files that cannot be found yet, so an empty result
// does not read as "this is not in any file".
export const searchResults = z.object({
  conversations: z.array(conversationHit),
  files: z.array(fileHit),
  unindexedFiles: z.number().int(),
});
export type SearchResults = z.infer<typeof searchResults>;
