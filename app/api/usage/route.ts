import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { memberLimits, members, usageEvents } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';
import { resolveProvider } from '@/lib/server/provider';

export const dynamic = 'force-dynamic';

const HISTORY_DAYS = 30;

// Zużycie zawsze tylko własne — `usage_events` nie ma pojęcia współdzielenia,
// a limity są przypisane do członka.
export async function GET() {
  try {
    const member = await requireMember();
    const db = getDb();
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const historyStart = new Date(dayStart.getTime() - (HISTORY_DAYS - 1) * 86_400_000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const day = sql<string>`strftime('%Y-%m-%d', ${usageEvents.createdAt} / 1000, 'unixepoch')`;
    const inputSum = sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`;
    const outputSum = sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)`;
    const requests = sql<number>`count(*)`;

    const [limit] = await db.select().from(memberLimits).where(eq(memberLimits.memberId, member.id)).limit(1);

    const byDay = await db
      .select({ day, inputTokens: inputSum, outputTokens: outputSum, requests })
      .from(usageEvents)
      .where(and(eq(usageEvents.memberId, member.id), gte(usageEvents.createdAt, historyStart)))
      .groupBy(day)
      .orderBy(day);

    const byModel = await db
      .select({ model: usageEvents.model, inputTokens: inputSum, outputTokens: outputSum, requests })
      .from(usageEvents)
      .where(and(eq(usageEvents.memberId, member.id), gte(usageEvents.createdAt, monthStart)))
      .groupBy(usageEvents.model)
      .orderBy(desc(inputSum));

    const [today] = await db
      .select({ inputTokens: inputSum, outputTokens: outputSum, requests })
      .from(usageEvents)
      .where(and(eq(usageEvents.memberId, member.id), gte(usageEvents.createdAt, dayStart)));

    const [month] = await db
      .select({ inputTokens: inputSum, outputTokens: outputSum, requests })
      .from(usageEvents)
      .where(and(eq(usageEvents.memberId, member.id), gte(usageEvents.createdAt, monthStart)));

    // Wlascicielowi pokazujemy zuzycie calego zespolu. Bez tego ustawia limity
    // i uzywa kill switcha na slepo - widzi wlasny wykres i nic wiecej. Ida tu
    // wylacznie liczby tokenow i zapytan: zadnych tytulow rozmow ani tresci.
    const team = member.role === 'owner' ? await db
      .select({
        memberId: members.id,
        displayName: members.displayName,
        role: members.role,
        status: members.status,
        dailyTokens: memberLimits.dailyTokens,
        monthlyTokens: memberLimits.monthlyTokens,
        apiEnabled: memberLimits.enabled,
        todayTokens: sql<number>`coalesce(sum(case when ${usageEvents.createdAt} >= ${dayStart.getTime()} then ${usageEvents.inputTokens} + ${usageEvents.outputTokens} else 0 end), 0)`,
        monthTokens: sql<number>`coalesce(sum(case when ${usageEvents.createdAt} >= ${monthStart.getTime()} then ${usageEvents.inputTokens} + ${usageEvents.outputTokens} else 0 end), 0)`,
        monthRequests: sql<number>`coalesce(sum(case when ${usageEvents.createdAt} >= ${monthStart.getTime()} then 1 else 0 end), 0)`,
      })
      .from(members)
      .leftJoin(memberLimits, eq(memberLimits.memberId, members.id))
      .leftJoin(usageEvents, eq(usageEvents.memberId, members.id))
      .groupBy(members.id)
      .orderBy(members.displayName)
      : [];

    const provider = await resolveProvider(member);
    const etykiety = new Map((provider?.models ?? []).map((entry) => [entry.id, entry.label]));
    return json({
      historyDays: HISTORY_DAYS,
      team,
      limits: { dailyTokens: limit?.dailyTokens ?? 0, monthlyTokens: limit?.monthlyTokens ?? 0, enabled: limit?.enabled ?? false },
      today: today ?? { inputTokens: 0, outputTokens: 0, requests: 0 },
      month: month ?? { inputTokens: 0, outputTokens: 0, requests: 0 },
      byDay,
      // Etykieta z listy dozwolonych modeli; jeśli model zniknął z allowlisty,
      // zostaje surowy identyfikator, żeby historia nie gubiła wierszy.
      byModel: byModel.map((row) => ({ ...row, label: etykiety.get(row.model) ?? row.model })),
    });
  } catch (error) { return errorResponse(error); }
}
