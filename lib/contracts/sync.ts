// The local folder agent: its on/off switch and its keys. See `common.ts`
// for how the contracts are used.

import { z } from 'zod';
import { id, isoDate } from './common';

// GET /api/sync. The switch covers only the local folder agent; no other
// source exists.
export const syncSetting = z.object({ enabled: z.boolean(), scope: z.literal('local-folder-agent') });
export type SyncSetting = z.infer<typeof syncSetting>;

// PUT /api/sync takes and answers this shape.
export const updateSyncRequest = z.object({ enabled: z.boolean() });
export type UpdateSyncRequest = z.input<typeof updateSyncRequest>;

export const syncCredential = z.object({
  id,
  label: z.string(),
  expiresAt: isoDate,
  lastUsedAt: isoDate.nullable(),
  createdAt: isoDate,
});
export type SyncCredential = z.infer<typeof syncCredential>;

// GET /api/sync/token: the member's keys that are not revoked.
export const syncCredentials = z.object({ tokens: z.array(syncCredential) });
export type SyncCredentials = z.infer<typeof syncCredentials>;

// POST /api/sync/token
export const createSyncTokenRequest = z.object({ label: z.string().trim().min(2).max(80).default('My computer') });
export type CreateSyncTokenRequest = z.input<typeof createSyncTokenRequest>;

// The key itself is in this response and nowhere else: the server keeps only
// its hash.
export const createSyncTokenResponse = z.object({
  token: z.string(),
  credential: syncCredential.pick({ id: true, label: true, expiresAt: true }),
});
export type CreateSyncTokenResponse = z.infer<typeof createSyncTokenResponse>;

// DELETE /api/sync/token takes `byIdRequest` and answers `revokedResponse`.
