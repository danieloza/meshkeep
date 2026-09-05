import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { memberLimits, members, sessions, syncTokens } from '@/db/schema';
import { requireOwner } from '@/lib/server/auth';
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { MAX_DAILY_TOKENS, MAX_MONTHLY_TOKENS } from '@/lib/limits';
import { recordAudit } from '@/lib/server/audit';

export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  status: z.enum(['active', 'suspended']).optional(),
  dailyTokens: z.number().int().min(0).max(MAX_DAILY_TOKENS).optional(),
  monthlyTokens: z.number().int().min(0).max(MAX_MONTHLY_TOKENS).optional(),
  apiEnabled: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'pusta zmiana' });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const owner = await requireOwner();
    const { id } = await context.params;
    const input = updateSchema.parse(await readJson(request));
    const db = getDb();

    const [target] = await db.select().from(members).where(eq(members.id, id)).limit(1);
    if (!target) throw new ApiError(404, 'This team member was not found.');

    // Owner nie może zawiesić samego siebie ani drugiego ownera —
    // to jedyna droga odzyskania kontroli nad chmurą, a odcięcie jej znaczyłoby
    // ręczny SQL na produkcyjnej bazie.
    if (input.status === 'suspended' && (target.id === owner.id || target.role === 'owner')) {
      throw new ApiError(400, 'The owner account cannot be suspended.');
    }

    const now = new Date();
    if (input.status) {
      await db.update(members).set({ status: input.status, updatedAt: now }).where(eq(members.id, id));
      // Zawieszenie ma działać natychmiast, a nie dopiero po wygaśnięciu sesji:
      // kasujemy sesje i odwołujemy klucze agenta synchronizacji.
      if (input.status === 'suspended') {
        await db.batch([
          db.delete(sessions).where(eq(sessions.memberId, id)),
          db.update(syncTokens).set({ revokedAt: now }).where(eq(syncTokens.memberId, id)),
        ]);
      }
      await recordAudit({ actorId: owner.id, actorLabel: owner.displayName, action: input.status === 'suspended' ? 'member.suspended' : 'member.activated', targetType: 'member', targetId: id, targetLabel: target.displayName });
    }

    const limitChanges: Partial<{ dailyTokens: number; monthlyTokens: number; enabled: boolean; updatedAt: Date }> = {};
    if (input.dailyTokens !== undefined) limitChanges.dailyTokens = input.dailyTokens;
    if (input.monthlyTokens !== undefined) limitChanges.monthlyTokens = input.monthlyTokens;
    if (input.apiEnabled !== undefined) limitChanges.enabled = input.apiEnabled;
    if (Object.keys(limitChanges).length) {
      limitChanges.updatedAt = now;
      await db.update(memberLimits).set(limitChanges).where(eq(memberLimits.memberId, id));
      await recordAudit({
        actorId: owner.id,
        actorLabel: owner.displayName,
        action: 'member.limits_changed',
        targetType: 'member',
        targetId: id,
        targetLabel: target.displayName,
        // Same liczby i przełącznik — żadnych danych osobowych ani treści.
        detail: { dziennie: input.dailyTokens, miesiecznie: input.monthlyTokens, api: input.apiEnabled },
      });
    }

    const [updated] = await db.select().from(members).where(eq(members.id, id)).limit(1);
    const [limit] = await db.select().from(memberLimits).where(eq(memberLimits.memberId, id)).limit(1);
    return json({
      member: { id, displayName: updated?.displayName, role: updated?.role, status: updated?.status },
      limits: { dailyTokens: limit?.dailyTokens ?? 0, monthlyTokens: limit?.monthlyTokens ?? 0, enabled: limit?.enabled ?? false },
      sessionsRevoked: input.status === 'suspended',
    });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Invalid account settings.' }, { status: 400 });
    return errorResponse(error);
  }
}
