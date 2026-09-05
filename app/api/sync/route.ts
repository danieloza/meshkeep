import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { appSettings } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { requireSyncToken } from '@/lib/server/session';

const syncSchema = z.object({ enabled: z.boolean() });

export async function GET(request: Request) {
  try {
    const member = request.headers.get('authorization') ? await requireSyncToken(request) : await requireMember();
    const key = `context_sync:${member.id}`;
    const [setting] = await getDb().select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    // Ten przełącznik dotyczy wyłącznie lokalnego agenta files. Nie istnieje
    // żaden konektor do Codex/Claude/Gemini/Grok, więc nie ogłaszamy „źródeł”.
    return json({ enabled: setting?.value === 'on', scope: 'local-folder-agent' });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const { enabled } = syncSchema.parse(await readJson(request));
    const key = `context_sync:${member.id}`;
    await getDb().insert(appSettings).values({ key, value: enabled ? 'on' : 'off', updatedAt: new Date() }).onConflictDoUpdate({ target: appSettings.key, set: { value: enabled ? 'on' : 'off', updatedAt: new Date() } });
    return json({ enabled });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Invalid sync setting.' }, { status: 400 });
    return errorResponse(error);
  }
}
