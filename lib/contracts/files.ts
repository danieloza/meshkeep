// Project files, their indexing and suggestions. See `common.ts` for how the
// contracts are used.

import { z } from 'zod';
import { id, isoDate } from './common';

// What became of a file's text. `pending`: not read yet. `indexed`: read, and
// `note` says if only part of it was. `unsupported`: no text by design, with
// the reason. `failed`: reading went wrong; `retrying` says whether the index
// will try again.
export const fileTextState = z.object({
  status: z.enum(['pending', 'indexed', 'unsupported', 'failed']),
  note: z.string().nullable(),
  retrying: z.boolean(),
});
export type FileTextState = z.infer<typeof fileTextState>;

export const projectFile = z.object({
  id,
  relativePath: z.string(),
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  createdAt: isoDate,
  text: fileTextState,
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
// `failed`: file-text reads that failed this round. `remaining`: file-text work
// due now; delayed retries are excluded. `passagesRemaining`: optional separate
// count of passage-index work due now, also excluding delayed retries; absent
// when passage indexing failed and its backlog could not be counted.
export const indexRound = z.object({ indexed: z.number().int(), failed: z.number().int(), remaining: z.number().int(), passagesRemaining: z.number().int().optional() });
export type IndexRound = z.infer<typeof indexRound>;

// GET /api/projects/[id]/suggest-files
export const fileSuggestion = z.object({ fileId: id, path: z.string(), snippet: z.string() });
export type FileSuggestion = z.infer<typeof fileSuggestion>;

export const fileSuggestions = z.object({ files: z.array(fileSuggestion) });
export type FileSuggestions = z.infer<typeof fileSuggestions>;

// GET /api/storage/google-drive/status: whether projects can store files in
// Google Drive on this deployment.
export const driveStatus = z.object({
  configured: z.boolean(),
  mode: z.literal('server-owned'),
  authorization: z.literal('application-acl'),
  scope: z.literal('drive.file'),
});
export type DriveStatus = z.infer<typeof driveStatus>;
