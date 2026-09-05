import { and, gte, lt, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { memberLimits, usageEvents } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';
import { resolveProvider } from '@/lib/server/provider';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const member = await requireMember();
    const db = getDb();
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [limit] = await db.select().from(memberLimits).where(sql`${memberLimits.memberId} = ${member.id}`).limit(1);
    const [usage] = await db.select({ input: sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`, output: sql<number>`coalesce(sum(${usageEvents.outputTokens}), 0)` }).from(usageEvents).where(and(sql`${usageEvents.memberId} = ${member.id}`, gte(usageEvents.createdAt, dayStart), lt(usageEvents.createdAt, dayEnd)));
    // The monthly limit is enforced by the chat route, so the dashboard must
    // report the same usage window.
    const [monthly] = await db.select({ tokens: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)` }).from(usageEvents).where(and(sql`${usageEvents.memberId} = ${member.id}`, gte(usageEvents.createdAt, monthStart), lt(usageEvents.createdAt, monthEnd)));
    // Which provider answers depends on the member: their own configuration if
    // they set one, otherwise the team default, otherwise the environment.
    const provider = await resolveProvider(member);
    return json({ member: { id: member.id, displayName: member.displayName, email: member.email, role: member.role }, limits: limit, usage: { inputTokens: usage?.input ?? 0, outputTokens: usage?.output ?? 0, monthlyTokens: monthly?.tokens ?? 0 }, models: provider?.models ?? [], provider: provider ? { label: provider.label, origin: provider.origin } : null });
  } catch (error) { return errorResponse(error); }
}
