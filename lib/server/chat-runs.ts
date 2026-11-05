import 'server-only';

import { and, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { chatRuns, usageEvents } from '@/db/schema';
import { abandonedRunCharge } from '@/lib/usage-policy';
import type { CurrentMember } from './auth';
import { ApiError } from './http';

// The budget for model answers.
//
// Limits used to be checked against the usage saved after each answer. Two
// requests sent together both passed that check, and an answer the worker did
// not get to save was never counted at all: once the client disconnects, the
// platform gives unfinished work about 30 seconds. So each answer now starts
// as a run that reserves its estimated prompt and its token ceiling. The
// reservation is written by one conditional statement, which D1 runs alone,
// so a request sees every reservation made before it. The limits count a
// reservation until its run is settled: by the real usage when the answer is
// saved, by nothing when the provider refused it, and by
// `abandonedRunCharge` when the worker stopped before either.

export const RUNS_PER_MINUTE = 10;

// Past this, a run still marked as running has no worker behind it. A
// streamed answer can outlive its client by about 30 seconds, and a runtime
// update lets open requests finish within 20 minutes.
export const ABANDONED_AFTER_MS = 30 * 60_000;

export type Reservation = { inputTokens: number; outputTokens: number };
export type UsageRow = typeof usageEvents.$inferInsert;
type Limits = { dailyTokens: number; monthlyTokens: number };

function windows(now: Date) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    day: [dayStart.getTime(), dayStart.getTime() + 86_400_000],
    month: [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime()],
    minuteStart: now.getTime() - 60_000,
  } as const;
}

// Saved usage plus the reservations of runs still going, within one window.
function committed(memberId: string, [from, to]: readonly [number, number]) {
  return sql`(
    (SELECT coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0) FROM ${usageEvents}
      WHERE ${usageEvents.memberId} = ${memberId} AND ${usageEvents.createdAt} >= ${from} AND ${usageEvents.createdAt} < ${to})
    + (SELECT coalesce(sum(${chatRuns.reservedInputTokens} + ${chatRuns.reservedOutputTokens}), 0) FROM ${chatRuns}
      WHERE ${chatRuns.memberId} = ${memberId} AND ${chatRuns.status} = 'running' AND ${chatRuns.createdAt} >= ${from} AND ${chatRuns.createdAt} < ${to})
  )`;
}

function recentRuns(memberId: string, since: number) {
  return sql`(SELECT count(*) FROM ${chatRuns} WHERE ${chatRuns.memberId} = ${memberId} AND ${chatRuns.createdAt} >= ${since})`;
}

function errorText(error: unknown): string {
  const parts: string[] = [];
  for (let current = error; current instanceof Error && parts.length < 5; current = current.cause) parts.push(current.message);
  return parts.join(' ');
}

// A run is settled by `chargeRun` then `finishRun`, in one batch. The usage is
// written only while the run is still running, so a run settled twice, by a
// late answer and by the sweep, is never charged twice.
export function chargeRun(runId: string, usage: UsageRow) {
  // The values are selected from the run's own row, which matches only while
  // the run is running. A settled run yields no row, so nothing is inserted.
  // A query builder, not `db.run(sql)`: drizzle cannot put raw SQL in a batch.
  return getDb().insert(usageEvents).select((qb) => qb
    .select({
      id: sql<string>`${usage.id}`.as('id'),
      memberId: sql<string>`${usage.memberId}`.as('member_id'),
      model: sql<string>`${usage.model}`.as('model'),
      inputTokens: sql<number>`${usage.inputTokens ?? 0}`.as('input_tokens'),
      outputTokens: sql<number>`${usage.outputTokens ?? 0}`.as('output_tokens'),
      // drizzle requires every column of the table here, in its order.
      providerId: sql<string | null>`${usage.providerId ?? null}`.as('provider_id'),
      createdAt: sql<Date>`${(usage.createdAt ?? new Date()).getTime()}`.as('created_at'),
    })
    .from(chatRuns)
    .where(and(eq(chatRuns.id, runId), eq(chatRuns.status, 'running'))));
}

export function finishRun(runId: string, status: 'succeeded' | 'failed' | 'abandoned') {
  return getDb().update(chatRuns).set({ status, finishedAt: new Date() }).where(and(eq(chatRuns.id, runId), eq(chatRuns.status, 'running')));
}

// Charges the runs whose worker stopped before settling them. Runs for every
// member, so the usage view is complete even for someone who has not come back.
export async function settleAbandonedRuns(now = new Date()) {
  const db = getDb();
  const stale = await db
    .select()
    .from(chatRuns)
    .where(and(eq(chatRuns.status, 'running'), lt(chatRuns.createdAt, new Date(now.getTime() - ABANDONED_AFTER_MS))))
    .limit(20);
  if (!stale.length) return 0;
  const [first, ...rest] = stale.flatMap((run) => [
    chargeRun(run.id, { id: crypto.randomUUID(), memberId: run.memberId, model: run.model, ...abandonedRunCharge(run), createdAt: run.createdAt }),
    finishRun(run.id, 'abandoned'),
  ]);
  await db.batch([first, ...rest]);
  return stale.length;
}

// Writes a running run holding `reserved`, or refuses with the limit that
// stands in the way. A second request with the same `clientRequestId` is
// refused: the first one is answering it, or already has.
export async function reserveRun(
  member: CurrentMember,
  limits: Limits,
  run: { projectId: string; conversationId: string; clientRequestId: string; model: string; reserved: Reservation },
): Promise<string> {
  const db = getDb();
  // A failure here must not stop the answer. Until they are settled,
  // abandoned runs keep counting with their whole reservation.
  await settleAbandonedRuns().catch((error: unknown) => console.error('Settling abandoned runs failed', errorText(error)));
  const now = new Date();
  const { day, month, minuteStart } = windows(now);
  const id = crypto.randomUUID();
  let changes = 0;
  try {
    const result = await db.run(sql`
      INSERT INTO ${chatRuns} (id, member_id, project_id, conversation_id, client_request_id, model, status, reserved_input_tokens, reserved_output_tokens, created_at)
      SELECT ${id}, ${member.id}, ${run.projectId}, ${run.conversationId}, ${run.clientRequestId}, ${run.model}, 'running', ${run.reserved.inputTokens}, ${run.reserved.outputTokens}, ${now.getTime()}
      WHERE ${committed(member.id, day)} < ${limits.dailyTokens}
        AND ${committed(member.id, month)} < ${limits.monthlyTokens}
        AND ${recentRuns(member.id, minuteStart)} < ${RUNS_PER_MINUTE}`);
    changes = result.meta.changes;
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(errorText(error))) {
      throw new ApiError(409, 'This message has already been sent. Reload the conversation to see its answer.');
    }
    throw error;
  }
  if (changes === 1) return id;

  // Refused. Say which limit, and whether answers still running hold it.
  const [state] = await db.all<{ daily: number; monthly: number; recent: number; dailySaved: number; monthlySaved: number }>(sql`
    SELECT ${committed(member.id, day)} AS daily, ${committed(member.id, month)} AS monthly, ${recentRuns(member.id, minuteStart)} AS recent,
      (SELECT coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0) FROM ${usageEvents} WHERE ${usageEvents.memberId} = ${member.id} AND ${usageEvents.createdAt} >= ${day[0]} AND ${usageEvents.createdAt} < ${day[1]}) AS dailySaved,
      (SELECT coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0) FROM ${usageEvents} WHERE ${usageEvents.memberId} = ${member.id} AND ${usageEvents.createdAt} >= ${month[0]} AND ${usageEvents.createdAt} < ${month[1]}) AS monthlySaved`);
  if (state.recent >= RUNS_PER_MINUTE) throw new ApiError(429, 'Too many requests. Try again in one minute.');
  if (state.daily >= limits.dailyTokens) {
    throw new ApiError(429, state.dailySaved >= limits.dailyTokens
      ? 'The daily token limit has been reached.'
      : 'Answers still in progress hold the rest of the daily token limit. Try again when they finish.');
  }
  throw new ApiError(429, state.monthlySaved >= limits.monthlyTokens
    ? 'The monthly token limit has been reached.'
    : 'Answers still in progress hold the rest of the monthly token limit. Try again when they finish.');
}

// The provider refused before answering, so nothing was generated and the
// reservation is simply given back.
export async function releaseRun(runId: string) {
  await finishRun(runId, 'failed');
}
