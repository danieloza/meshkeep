import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { conversations, files, members, projectMembers, projects } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { assertSameOrigin, errorResponse, json, readJson } from '@/lib/server/http';
import { createDriveFolder, googleDriveConfigured } from '@/lib/server/google-drive';

export const dynamic = 'force-dynamic';

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(''),
  visibility: z.enum(['private', 'selected', 'team']).default('private'),
  selectedMembers: z.array(z.uuid()).max(3).default([]),
  members: z.array(z.object({ memberId: z.uuid(), role: z.enum(['reader', 'editor']) })).max(3).default([]),
  storageProvider: z.enum(['r2', 'google_drive']).default('r2'),
});

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
        memberRole: projectMembers.role,
        fileCount: sql<number>`(select count(*) from ${files} where ${files.projectId} = ${projects.id})`,
        conversationCount: sql<number>`(select count(*) from ${conversations} where ${conversations.projectId} = ${projects.id})`,
      })
      .from(projects)
      .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.memberId, member.id)))
      .where(or(eq(projects.ownerId, member.id), eq(projects.visibility, 'team'), eq(projectMembers.memberId, member.id)))
      .orderBy(desc(projects.updatedAt));
    return json({ projects: rows.map((row) => ({ ...row, canEdit: row.ownerId === member.id || row.memberRole === 'editor' })) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const input = createProjectSchema.parse(await readJson(request));
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
