import { and, eq, inArray } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getDb } from '@/db';
import { files, members, projectMembers, projects } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { recordAudit } from '@/lib/server/audit';
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';

const updateSchema = z.object({
  visibility: z.enum(['private', 'selected', 'team']),
  members: z.array(z.object({ memberId: z.uuid(), role: z.enum(['reader', 'editor']) })).max(3).default([]),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const { id } = await context.params;
    const input = updateSchema.parse(await readJson(request));
    const db = getDb();
    const [project] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, member.id))).limit(1);
    if (!project) throw new ApiError(404, 'No project owned by you was found.');
    const selected = input.visibility === 'selected' ? input.members.filter((item) => item.memberId !== member.id) : [];
    if (selected.length) {
      const ids = [...new Set(selected.map((item) => item.memberId))];
      const validMembers = await db.select({ id: members.id }).from(members).where(and(inArray(members.id, ids), eq(members.status, 'active')));
      if (validMembers.length !== ids.length) throw new ApiError(400, 'A person outside the active team was selected.');
    }
    await db.batch([
      db.delete(projectMembers).where(eq(projectMembers.projectId, id)),
      db.update(projects).set({ visibility: input.visibility, updatedAt: new Date() }).where(eq(projects.id, id)),
    ]);
    if (selected.length) await db.insert(projectMembers).values(selected.map((item) => ({ projectId: id, memberId: item.memberId, role: item.role, createdAt: new Date() })));
    return json({ project: { id, visibility: input.visibility, members: selected } });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Invalid sharing settings.' }, { status: 400 });
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const { id } = await context.params;
    const db = getDb();
    const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, member.id))).limit(1);
    if (!project) throw new ApiError(404, 'No project owned by you was found.');
    const storedFiles = await db.select({ objectKey: files.objectKey }).from(files).where(eq(files.projectId, id));
    await db.delete(projects).where(eq(projects.id, id));
    await Promise.allSettled(storedFiles.map((file) => env.FILES.delete(file.objectKey)));
    await recordAudit({ actorId: member.id, actorLabel: member.displayName, action: 'project.deleted', targetType: 'project', targetId: id, targetLabel: project.name, detail: { plikow: storedFiles.length } });
    return json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
