import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { appSettings } from '@/db/schema';
import { requireOwner } from '@/lib/server/auth';
import { recordAudit } from '@/lib/server/audit';
import { assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

// Uwaga na semantykę: `api_kill_switch = 'on'` oznacza, że wyłącznik jest
// WCIŚNIĘTY, czyli dostęp do modeli jest ZABLOKOWANY (patrz assertChatAllowed).
const KILL_SWITCH_KEY = 'api_kill_switch';
const settingsSchema = z.object({ apiKillSwitch: z.boolean() });

async function readKillSwitch() {
  const [row] = await getDb().select().from(appSettings).where(eq(appSettings.key, KILL_SWITCH_KEY)).limit(1);
  return row?.value === 'on';
}

export async function GET() {
  try {
    await requireOwner();
    return json({ apiKillSwitch: await readKillSwitch() });
  } catch (error) { return errorResponse(error); }
}

// Do tej pory kill switch był tylko odczytywany — żaden endpoint go nie
// zapisywał, więc jedynym sposobem odcięcia modeli był ręczny SQL na
// produkcyjnej bazie.
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const owner = await requireOwner();
    const { apiKillSwitch } = settingsSchema.parse(await readJson(request));
    const value = apiKillSwitch ? 'on' : 'off';
    await getDb()
      .insert(appSettings)
      .values({ key: KILL_SWITCH_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    await recordAudit({ actorId: owner.id, actorLabel: owner.displayName, action: apiKillSwitch ? 'settings.kill_switch_on' : 'settings.kill_switch_off', targetType: 'settings', targetId: KILL_SWITCH_KEY });
    return json({ apiKillSwitch });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Invalid setting.' }, { status: 400 });
    return errorResponse(error);
  }
}
