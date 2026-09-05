import 'server-only';

import { and, count, eq, gte, lt, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { appSettings, memberLimits, usageEvents } from '@/db/schema';
import type { CurrentMember } from './auth';
import { ApiError } from './http';

// Limits and the kill switch only. Talking to a provider lives in
// `provider.ts`, because which provider answers is now a per-member setting
// rather than a constant.

export async function assertChatAllowed(member: CurrentMember) {
  const db = getDb();
  const [killSwitch] = await db.select().from(appSettings).where(eq(appSettings.key, 'api_kill_switch')).limit(1);
  if (killSwitch?.value === 'on') throw new ApiError(503, 'Model access has been temporarily disabled by the owner.');

  const [limit] = await db.select().from(memberLimits).where(eq(memberLimits.memberId, member.id)).limit(1);
  if (!limit?.enabled) throw new ApiError(403, 'API access is disabled for this account.');
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const minuteStart = new Date(now.getTime() - 60_000);
  const spent = sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)`;
  const [daily] = await db.select({ tokens: spent }).from(usageEvents).where(and(eq(usageEvents.memberId, member.id), gte(usageEvents.createdAt, dayStart), lt(usageEvents.createdAt, dayEnd)));
  // Monthly limit był dotąd tylko kolumną w schemacie — nikt go nie sprawdzał,
  // więc jedyną barierą kosztową był limit dzienny razy trzydzieści.
  const [monthly] = await db.select({ tokens: spent }).from(usageEvents).where(and(eq(usageEvents.memberId, member.id), gte(usageEvents.createdAt, monthStart), lt(usageEvents.createdAt, monthEnd)));
  const [recent] = await db.select({ value: count() }).from(usageEvents).where(and(eq(usageEvents.memberId, member.id), gte(usageEvents.createdAt, minuteStart)));
  if ((daily?.tokens ?? 0) >= limit.dailyTokens) throw new ApiError(429, 'The daily token limit has been reached.');
  if ((monthly?.tokens ?? 0) >= limit.monthlyTokens) throw new ApiError(429, 'The monthly token limit has been reached.');
  if ((recent?.value ?? 0) >= 10) throw new ApiError(429, 'Too many requests. Try again in one minute.');
}
