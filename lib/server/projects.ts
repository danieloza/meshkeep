import 'server-only';

import { and, eq, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { projectMembers, projects } from '@/db/schema';
import type { CurrentMember } from './auth';
import { ApiError } from './http';

export async function requireProjectAccess(
  member: CurrentMember,
  projectId: string,
  mode: 'read' | 'edit',
) {
  const db = getDb();
  const [row] = await db
    .select({ project: projects, memberRole: projectMembers.role })
    .from(projects)
    .leftJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, projects.id),
        eq(projectMembers.memberId, member.id),
      ),
    )
    .where(
      and(
        eq(projects.id, projectId),
        or(
          eq(projects.ownerId, member.id),
          eq(projects.visibility, 'team'),
          eq(projectMembers.memberId, member.id),
        ),
      ),
    )
    .limit(1);

  if (!row) throw new ApiError(404, 'Project not found.');
  const canEdit = row.project.ownerId === member.id || row.memberRole === 'editor';
  if (mode === 'edit' && !canEdit) {
    throw new ApiError(403, 'You do not have permission to edit this project.');
  }
  return { ...row, canEdit };
}
