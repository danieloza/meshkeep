// Token limits and usage. See `common.ts` for how the contracts are used.

import { z } from 'zod';
import { id, memberRole, memberStatus } from './common';

export const memberLimits = z.object({
  dailyTokens: z.number().int(),
  monthlyTokens: z.number().int(),
  enabled: z.boolean(),
});
export type MemberLimits = z.infer<typeof memberLimits>;

export const tokenTotals = z.object({
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  requests: z.number().int(),
});
export type TokenTotals = z.infer<typeof tokenTotals>;

// One row per member, for the owner only. Token counts and request counts,
// never conversation titles or content.
export const teamUsageRow = z.object({
  memberId: id,
  displayName: z.string(),
  role: memberRole,
  status: memberStatus,
  // Null for a member without a limits row.
  dailyTokens: z.number().int().nullable(),
  monthlyTokens: z.number().int().nullable(),
  apiEnabled: z.boolean().nullable(),
  todayTokens: z.number().int(),
  monthTokens: z.number().int(),
  monthRequests: z.number().int(),
});
export type TeamUsageRow = z.infer<typeof teamUsageRow>;

// GET /api/usage: always the member's own usage, plus the whole team's for
// the owner.
export const usageResponse = z.object({
  historyDays: z.number().int(),
  // Empty for everyone except the owner.
  team: z.array(teamUsageRow),
  limits: memberLimits,
  today: tokenTotals,
  month: tokenTotals,
  byDay: z.array(tokenTotals.extend({ day: z.string() })),
  // `label` falls back to the raw model id once a model leaves the list.
  byModel: z.array(tokenTotals.extend({ model: z.string(), label: z.string() })),
});
export type UsageResponse = z.infer<typeof usageResponse>;
