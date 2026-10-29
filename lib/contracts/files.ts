// Project files, their indexing and suggestions. See `common.ts` for how the
// contracts are used.

import { z } from 'zod';
import { id, isoDate } from './common';

export const projectFile = z.object({
  id,
  relativePath: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  createdAt: isoDate,
});
export type ProjectFile = z.infer<typeof projectFile>;

// GET /api/projects/[id]/files, and POST with the files just uploaded.
export const projectFiles = z.object({ files: z.array(projectFile) });
export type ProjectFiles = z.infer<typeof projectFiles>;

// DELETE /api/projects/[id]/files: the sync agent removing files that
// disappeared from disk.
export const MAX_PRUNE_PATHS = 200;

export const pruneFilesRequest = z.object({
  paths: z.array(z.string().min(1).max(400)).min(1).max(MAX_PRUNE_PATHS),
});
export type PruneFilesRequest = z.input<typeof pruneFilesRequest>;

export const pruneFilesResponse = z.object({ deleted: z.number().int(), notFound: z.number().int() });
export type PruneFilesResponse = z.infer<typeof pruneFilesResponse>;

// POST /api/projects/[id]/search-index
export const indexRound = z.object({ indexed: z.number().int(), remaining: z.number().int() });
export type IndexRound = z.infer<typeof indexRound>;

// GET /api/projects/[id]/suggest-files
export const fileSuggestion = z.object({ fileId: id, path: z.string(), snippet: z.string() });
export type FileSuggestion = z.infer<typeof fileSuggestion>;

export const fileSuggestions = z.object({ files: z.array(fileSuggestion) });
export type FileSuggestions = z.infer<typeof fileSuggestions>;
