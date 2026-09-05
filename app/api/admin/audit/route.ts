import { desc } from 'drizzle-orm';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema';
import { requireOwner } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

const MAX_EVENTS = 200;

// Dziennik czyta wyłącznie owner. Nie ma tu treści rozmów ani sekretów —
// pilnuje tego `serializeDetail` po stronie zapisu — ale zestawienie kto, kogo
// i kiedy odciął to i tak informacja wyłącznie dla niego.
export async function GET() {
  try {
    await requireOwner();
    const rows = await getDb()
      .select({
        id: auditEvents.id,
        actorLabel: auditEvents.actorLabel,
        action: auditEvents.action,
        targetType: auditEvents.targetType,
        targetLabel: auditEvents.targetLabel,
        detail: auditEvents.detail,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .orderBy(desc(auditEvents.createdAt))
      .limit(MAX_EVENTS);
    return json({ events: rows, limit: MAX_EVENTS });
  } catch (error) { return errorResponse(error); }
}
