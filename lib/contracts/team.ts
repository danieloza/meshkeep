// Team members, invitations and per-member settings. See `common.ts` for how
// the contracts are used.

import { z } from 'zod';
import { MAX_DAILY_TOKENS, MAX_MONTHLY_TOKENS } from '@/lib/limits';
import { id, isoDate, memberRole, memberStatus } from './common';
import { memberLimits } from './usage';

// Email and limits reach only the owner. Everyone else gets names, roles and
// status, which is all the panel shows them.
export const teamMember = z.object({
  id,
  displayName: z.string(),
  role: memberRole,
  status: memberStatus,
  email: z.string().optional(),
  // Null for a member without a limits row.
  dailyTokens: z.number().int().nullable().optional(),
  monthlyTokens: z.number().int().nullable().optional(),
  apiEnabled: z.boolean().nullable().optional(),
});
export type TeamMember = z.infer<typeof teamMember>;

export const pendingInvite = z.object({ id, email: z.string(), expiresAt: isoDate });
export type PendingInvite = z.infer<typeof pendingInvite>;

// GET /api/team. Invitations are listed to the owner only.
export const teamResponse = z.object({
  members: z.array(teamMember),
  // Invitations that hold a seat.
  pendingInvites: z.array(pendingInvite),
  // Links back into an existing account, which hold no seat.
  reconnectLinks: z.array(pendingInvite),
  capacity: z.object({ used: z.number().int(), total: z.number().int() }),
});
export type TeamResponse = z.infer<typeof teamResponse>;

// POST /api/team
export const inviteRequest = z.object({ email: z.email().trim().toLowerCase().max(254) });
export type InviteRequest = z.input<typeof inviteRequest>;

export const inviteResponse = z.object({
  invite: z.object({
    id,
    email: z.string(),
    expiresInDays: z.number().int(),
    joinPath: z.string(),
    // An address that already belongs to the team gets a reconnect link.
    kind: z.enum(['invite', 'reconnect']),
  }),
  signInRequired: z.boolean(),
  authProvider: z.enum(['app-session-or-chatgpt', 'app-session']),
});
export type InviteResponse = z.infer<typeof inviteResponse>;

// DELETE /api/team takes `byIdRequest` and answers `revokedResponse`.

// PATCH /api/team/members/[id]
export const updateMemberRequest = z.object({
  status: memberStatus.optional(),
  dailyTokens: z.number().int().min(0).max(MAX_DAILY_TOKENS).optional(),
  monthlyTokens: z.number().int().min(0).max(MAX_MONTHLY_TOKENS).optional(),
  apiEnabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'pusta zmiana' });
export type UpdateMemberRequest = z.input<typeof updateMemberRequest>;

export const updateMemberResponse = z.object({
  member: z.object({ id, displayName: z.string(), role: memberRole, status: memberStatus }),
  limits: memberLimits,
  // Suspending signs the member out of every session at once.
  sessionsRevoked: z.boolean(),
});
export type UpdateMemberResponse = z.infer<typeof updateMemberResponse>;
