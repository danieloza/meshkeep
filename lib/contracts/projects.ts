// Projects, their sharing and their instructions. See `common.ts` for how the
// contracts are used.

import { z } from 'zod';
import { id, isoDate, shareRole, visibility } from './common';

export const storageProvider = z.enum(['r2', 'google_drive']);
export type StorageProvider = z.infer<typeof storageProvider>;

export const projectShare = z.object({ memberId: id, role: shareRole });
export type ProjectShare = z.infer<typeof projectShare>;

// A project as the lists show it, with the member's share role and whether
// they may edit it.
export const projectSummary = z.object({
  id,
  ownerId: id,
  name: z.string(),
  description: z.string(),
  visibility,
  storageProvider,
  updatedAt: isoDate,
  memberRole: shareRole.nullable(),
  fileCount: z.number().int(),
  conversationCount: z.number().int(),
  canEdit: z.boolean(),
});
export type ProjectSummary = z.infer<typeof projectSummary>;

// GET /api/projects
export const projectList = z.object({ projects: z.array(projectSummary) });
export type ProjectList = z.infer<typeof projectList>;

// POST /api/projects
export const createProjectRequest = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  visibility: visibility.default('private'),
  selectedMembers: z.array(id).max(3).default([]),
  members: z.array(projectShare).max(3).default([]),
  storageProvider: storageProvider.default('r2'),
});
export type CreateProjectRequest = z.input<typeof createProjectRequest>;

// A new project has no conversations and its creator has no share role in it.
export const createProjectResponse = z.object({
  project: projectSummary.omit({ memberRole: true, conversationCount: true }),
});
export type CreateProjectResponse = z.infer<typeof createProjectResponse>;

// PATCH /api/projects/[id]
export const updateSharingRequest = z.object({
  visibility,
  members: z.array(projectShare).max(3).default([]),
});
export type UpdateSharingRequest = z.input<typeof updateSharingRequest>;

export const updateSharingResponse = z.object({
  project: z.object({ id, visibility, members: z.array(projectShare) }),
});
export type UpdateSharingResponse = z.infer<typeof updateSharingResponse>;

// GET and PUT /api/projects/[id]/instructions
export const MAX_INSTRUCTIONS_CHARS = 4_000;

export const instructionsResponse = z.object({
  instructions: z.string(),
  canEdit: z.boolean(),
  limit: z.number().int(),
});
export type InstructionsResponse = z.infer<typeof instructionsResponse>;

export const updateInstructionsRequest = z.object({ instructions: z.string().max(MAX_INSTRUCTIONS_CHARS) });
export type UpdateInstructionsRequest = z.input<typeof updateInstructionsRequest>;

export const updateInstructionsResponse = z.object({ instructions: z.string() });
export type UpdateInstructionsResponse = z.infer<typeof updateInstructionsResponse>;
