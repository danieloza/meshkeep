import { and, eq, inArray } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { getDb } from '@/db';
import { files, members, projectMembers, projects } from '@/db/schema';
import { updateSharingRequest } from '@/lib/contracts/projects';
import { requireMember } from '@/lib/server/auth';
import { auditInsert, recordAudit } from '@/lib/server/audit';
import { ApiError, assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const { id } = await context.params;
    const input = updateSharingRequest.parse(await readJson(request));
    const db = getDb();
    const [project] = await db.select().from(projects).where(and(eq(projects.id, id), eq(projects.ownerId, member.id))).limit(1);
    if (!project) throw new ApiError(404, 'No project owned by you was found.');
    // One share per person: a repeated id keeps its first place and its last
    // role, as in POST /api/projects. Inserting it twice would break the key.
    const selected = input.visibility === 'selected' ? [...new Map(input.members.filter((item) => item.memberId !== member.id).map((item) => [item.memberId, item])).values()] : [];
    const names = new Map<string, string>();
    if (selected.length) {
      const validMembers = await db.select({ id: members.id, displayName: members.displayName }).from(members).where(and(inArray(members.id, selected.map((item) => item.memberId)), eq(members.status, 'active')));
      if (validMembers.length !== selected.length) throw new ApiError(400, 'A person outside the active team was selected.');
      for (const row of validMembers) names.set(row.id, row.displayName);
    }
    // The old shares go, the new ones come and the change is logged in one
    // batch, so a failure cannot leave the project shared with nobody or the
    // change without its audit event. A person who stays keeps the date they
    // were added and newcomers follow in the order sent, since lists show the
    // oldest share first and a role change must not reorder them.
    const now = new Date();
    const since = new Map((await db.select({ memberId: projectMembers.memberId, createdAt: projectMembers.createdAt }).from(projectMembers).where(eq(projectMembers.projectId, id))).map((row) => [row.memberId, row.createdAt]));
    await db.batch([
      db.delete(projectMembers).where(eq(projectMembers.projectId, id)),
      db.update(projects).set({ visibility: input.visibility, updatedAt: now }).where(eq(projects.id, id)),
      auditInsert(db, {
        actorId: member.id,
        actorLabel: member.displayName,
        action: 'project.sharing_changed',
        targetType: 'project',
        targetId: id,
        targetLabel: project.name,
        detail: { from: project.visibility, to: input.visibility, people: selected.map((item) => `${names.get(item.memberId)} (${item.role})`).join(', ') },
      }),
      ...(selected.length ? [db.insert(projectMembers).values(selected.map((item, index) => ({ projectId: id, memberId: item.memberId, role: item.role, createdAt: since.get(item.memberId) ?? new Date(now.getTime() + index) })))] : []),
    ]);
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
