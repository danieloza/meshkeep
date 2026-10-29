import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { recordAudit } from '@/lib/server/audit';
import { assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { requireProjectAccess } from '@/lib/server/access';

export const dynamic = 'force-dynamic';

const MAX_INSTRUCTIONS_CHARS = 4_000;

const updateSchema = z.object({ instructions: z.string().max(MAX_INSTRUCTIONS_CHARS) });

// Anyone who can read the project sees the instructions, because they shape
// every answer in it. Only people who can edit the project may change them:
// the same people who can already change which files the model reads.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember();
    const { id } = await context.params;
    const access = await requireProjectAccess(member, id, 'read');
    return json({ instructions: access.project.instructions, canEdit: access.canEdit, limit: MAX_INSTRUCTIONS_CHARS });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const { id } = await context.params;
    const access = await requireProjectAccess(member, id, 'edit');
    const input = updateSchema.parse(await readJson(request));
    const instructions = input.instructions.trim();
    await getDb().update(projects).set({ instructions, updatedAt: new Date() }).where(eq(projects.id, id));
    // The audit log records that the instructions changed and how long they
    // are now, never their text: it follows the same no-content rule as chats.
    await recordAudit({
      actorId: member.id,
      actorLabel: member.displayName,
      action: 'project.instructions_updated',
      targetType: 'project',
      targetId: id,
      targetLabel: access.project.name,
      detail: { znaki: instructions.length },
    });
    return json({ instructions });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: `Instructions can be at most ${MAX_INSTRUCTIONS_CHARS} characters.` }, { status: 400 });
    return errorResponse(error);
  }
}
