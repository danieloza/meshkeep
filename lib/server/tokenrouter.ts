import 'server-only';

import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { appSettings, memberLimits } from '@/db/schema';
import type { CurrentMember } from './auth';
import { ApiError } from './http';

// The kill switch and the account switch. The token limits themselves are
// enforced when an answer reserves its budget, in `chat-runs.ts`, because only
// a check that writes the reservation in the same statement sees requests
// running at the same time. Talking to a provider lives in `provider.ts`.

export async function assertChatAllowed(member: CurrentMember) {
  const db = getDb();
  const [killSwitch] = await db.select().from(appSettings).where(eq(appSettings.key, 'api_kill_switch')).limit(1);
  if (killSwitch?.value === 'on') throw new ApiError(503, 'Model access has been temporarily disabled by the owner.');

  const [limit] = await db.select().from(memberLimits).where(eq(memberLimits.memberId, member.id)).limit(1);
  if (!limit?.enabled) throw new ApiError(403, 'API access is disabled for this account.');
  return { dailyTokens: limit.dailyTokens, monthlyTokens: limit.monthlyTokens };
}
