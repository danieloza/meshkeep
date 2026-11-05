import { z } from 'zod';
import { id as idSchema } from '@/lib/contracts/common';
import { updateConnectionRequest } from '@/lib/contracts/providers';
import { requireMember } from '@/lib/server/auth';
import { recordAudit } from '@/lib/server/audit';
import { assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { describeConnection, manageableConnection, removeConnection, updateConnection, weeklyUsage } from '@/lib/server/provider';

export const dynamic = 'force-dynamic';

// Renames a connection, or chooses which of its models the chat offers and
// which accept Effort. Anyone may change their own connections; only the owner
// the team's.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const connectionId = idSchema.parse((await context.params).id);
    const input = updateConnectionRequest.parse(await readJson(request));
    const before = await manageableConnection(member, connectionId);
    const row = await updateConnection(before, input);

    const audit = { actorId: member.id, actorLabel: member.displayName, targetType: 'provider' as const, targetId: row.id, targetLabel: row.label };
    if (input.label !== undefined && input.label !== before.label) await recordAudit({ ...audit, action: 'provider.renamed', detail: { from: before.label, to: row.label } });
    if (input.chatModels !== undefined) await recordAudit({ ...audit, action: 'provider.chat_models', detail: { models: input.chatModels === null ? 'all' : input.chatModels.length } });
    if (input.effortModels !== undefined) await recordAudit({ ...audit, action: 'provider.effort_models', detail: { models: input.effortModels.length } });

    const usage = await weeklyUsage(member, [row.id]);
    return json({ connection: describeConnection(row, member, usage.get(row.id)!) });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Invalid connection change.' }, { status: 400 });
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const connectionId = idSchema.parse((await context.params).id);
    const row = await manageableConnection(member, connectionId);
    await removeConnection(row);
    await recordAudit({
      actorId: member.id,
      actorLabel: member.displayName,
      action: 'provider.removed',
      targetType: 'provider',
      targetId: row.id,
      targetLabel: row.label,
      detail: { scope: row.scope === member.id ? 'mine' : 'team' },
    });
    return json({ removed: true });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Invalid connection.' }, { status: 400 });
    return errorResponse(error);
  }
}
