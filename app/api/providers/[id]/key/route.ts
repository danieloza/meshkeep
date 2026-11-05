import { z } from 'zod';
import { id as idSchema } from '@/lib/contracts/common';
import { replaceKeyRequest } from '@/lib/contracts/providers';
import { requireMember } from '@/lib/server/auth';
import { recordAudit } from '@/lib/server/audit';
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { assertProviderKeyEncryptionConfigured, checkProvider, describeConnection, manageableConnection, replaceKey, weeklyUsage } from '@/lib/server/provider';

export const dynamic = 'force-dynamic';

// Replaces a connection's key. The new key is checked against the provider
// first; if the check fails, nothing is written and the old key keeps
// answering, so a mistyped replacement never breaks the chat.
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const connectionId = idSchema.parse((await context.params).id);
    const input = replaceKeyRequest.parse(await readJson(request));
    const before = await manageableConnection(member, connectionId);
    assertProviderKeyEncryptionConfigured();

    const check = await checkProvider(before.baseUrl, input.apiKey);
    if (!check.ok) throw new ApiError(400, `${check.reason} The previous key is still in use.`);
    const row = await replaceKey(before, input.apiKey, check.models);

    await recordAudit({
      actorId: member.id,
      actorLabel: member.displayName,
      action: 'provider.key_replaced',
      targetType: 'provider',
      targetId: row.id,
      targetLabel: row.label,
      detail: { models: check.models.length },
    });
    const usage = await weeklyUsage(member, [row.id]);
    return json({ connection: describeConnection(row, member, usage.get(row.id)!) });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Paste the new key.' }, { status: 400 });
    return errorResponse(error);
  }
}
