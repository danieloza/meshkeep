// Owner-only routes: the activity log, the emergency cutoff and the storage
// check. See `common.ts` for how the contracts are used.

import { z } from 'zod';
import { id, isoDate } from './common';

// `detail` is a JSON object of plain values written by `serializeDetail`,
// stored and sent as text. It never holds conversation content or secrets.
export const auditEvent = z.object({
  id,
  actorLabel: z.string(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetLabel: z.string().nullable(),
  detail: z.string().nullable(),
  createdAt: isoDate,
});
export type AuditEvent = z.infer<typeof auditEvent>;

// GET /api/admin/audit: the newest events, at most `limit` of them.
export const auditLog = z.object({ events: z.array(auditEvent), limit: z.number().int() });
export type AuditLog = z.infer<typeof auditLog>;

// GET and PUT /api/admin/settings take and answer the same shape. `true`
// means the cutoff is pressed and every model request is blocked.
export const killSwitchSettings = z.object({ apiKillSwitch: z.boolean() });
export type KillSwitchSettings = z.infer<typeof killSwitchSettings>;

// POST /api/admin/backup: whether file storage matches the database.
// GET on the same route downloads the backup file itself.
export const storageCheck = z.object({
  checkedAt: isoDate,
  // Storage is listed up to 1,000 objects.
  truncated: z.boolean(),
  inDatabase: z.number().int(),
  inStorage: z.number().int(),
  // Files the database lists that storage does not have: they cannot be
  // downloaded.
  missingInStorage: z.array(z.string()),
  // Objects no database row points to: they only take up space.
  orphanInStorage: z.array(z.string()),
});
export type StorageCheck = z.infer<typeof storageCheck>;
