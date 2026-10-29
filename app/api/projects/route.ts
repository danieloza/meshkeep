import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { conversations, files, members, projectMembers, projects } from '@/db/schema';
import { createProjectRequest } from '@/lib/contracts/projects';
import { canEditProject, readableBy, shareRoleOf } from '@/lib/server/access';
import { requireMember } from '@/lib/server/auth';
import { assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { createDriveFolder, googleDriveConfigured } from '@/lib/server/google-drive';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const member = await requireMember();
    const db = getDb();
    const rows = await db
      .select({
        id: projects.id,
        ownerId: projects.ownerId,
        name: projects.name,
        description: projects.description,
        visibility: projects.visibility,
        storageProvider: projects.storageProvider,
        updatedAt: projects.updatedAt,
        memberRole: shareRoleOf(member.id),
        fileCount: sql<number>`(select count(*) from ${files} where ${files.projectId} = ${projects.id})`,
        conversationCount: sql<number>`(select count(*) from ${conversations} where ${conversations.projectId} = ${projects.id})`,
      })
      .from(projects)
      .where(readableBy(member.id))
      .orderBy(desc(projects.updatedAt));
    return json({ projects: rows.map((row) => ({ ...row, canEdit: canEditProject(row.ownerId, member.id, row.memberRole) })) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const input = createProjectRequest.parse(await readJson(request));
    const db = getDb();
    const now = new Date();
    const id = crypto.randomUUID();
    const requestedShares = input.members.length ? input.members : input.selectedMembers.map((memberId) => ({ memberId, role: 'editor' as const }));
    const selected = input.visibility === 'selected' ? [...new Map(requestedShares.filter((item) => item.memberId !== member.id).map((item) => [item.memberId, item])).values()] : [];
    if (selected.length) {
      const validMembers = await db.select({ id: members.id }).from(members).where(and(inArray(members.id, selected.map((item) => item.memberId)), eq(members.status, 'active')));
      if (validMembers.length !== selected.length) return json({ error: 'A person outside the active team was selected.' }, { status: 400 });
    }
    if (input.storageProvider === 'google_drive' && !googleDriveConfigured()) return json({ error: 'Configure Google Drive on the server first.' }, { status: 503 });
    const driveFolderId = input.storageProvider === 'google_drive' ? await createDriveFolder(input.name) : null;
    await db.insert(projects).values({ id, ownerId: member.id, name: input.name, description: input.description, visibility: input.visibility, storageProvider: input.storageProvider, driveFolderId, createdAt: now, updatedAt: now });
    if (selected.length) {
      await db.insert(projectMembers).values(selected.map((share) => ({ projectId: id, memberId: share.memberId, role: share.role, createdAt: now })));
    }
    return json({ project: { id, ...input, ownerId: member.id, fileCount: 0, canEdit: true, updatedAt: now.toISOString() } }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'Check the project name and settings.' }, { status: 400 });
    return errorResponse(error);
  }
}
