import { z } from 'zod';
import { id as idSchema } from '@/lib/contracts/common';
import { requireMember } from '@/lib/server/auth';
import { assertSameOrigin, errorResponse, json } from '@/lib/server/http';
import { checkProvider, describeConnection, manageableConnection, recordCheck, storedKey, weeklyUsage } from '@/lib/server/provider';

export const dynamic = 'force-dynamic';

// Checks the stored key again and refreshes the model list. The result is
// recorded either way, so the settings show when the key last worked. A
// failed check is an answer, not an error: the response says what happened.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const connectionId = idSchema.parse((await context.params).id);
    const before = await manageableConnection(member, connectionId);
    const row = await recordCheck(before, await checkProvider(before.baseUrl, await storedKey(before)));
    const usage = await weeklyUsage(member, [row.id]);
    return json({ connection: describeConnection(row, member, usage.get(row.id)!) });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Invalid connection.' }, { status: 400 });
    return errorResponse(error);
  }
}
