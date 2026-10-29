import 'server-only';

import { and, eq, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { projectMembers, projects } from '@/db/schema';
import type { CurrentMember } from './auth';
import { ApiError } from './http';

// The one place that decides who may read and edit a project. Lists, single
// project routes and search all build on these, so the rule cannot drift
// between copies.
//
// Read: the owner, everyone when the project is shared with the team, and the
// people it is shared with by name. Edit: the owner and people shared with as
// editors. A team project on its own gives read access only.

export type ShareRole = (typeof projectMembers.$inferSelect)['role'];

// The read rule as SQL over the `projects` table, for the database to filter
// with. Content from a project the member cannot open never leaves it.
export function readableBy(memberId: string): SQL {
  return sql`(${projects.ownerId} = ${memberId} OR ${projects.visibility} = 'team' OR EXISTS (SELECT 1 FROM ${projectMembers} WHERE ${projectMembers.projectId} = ${projects.id} AND ${projectMembers.memberId} = ${memberId}))`;
}

// The member's share role in the project of the current row, or null.
export function shareRoleOf(memberId: string) {
  return sql<ShareRole | null>`(SELECT ${projectMembers.role} FROM ${projectMembers} WHERE ${projectMembers.projectId} = ${projects.id} AND ${projectMembers.memberId} = ${memberId})`;
}

export function canEditProject(ownerId: string, memberId: string, share: ShareRole | null): boolean {
  return ownerId === memberId || share === 'editor';
}

export async function requireProjectAccess(
  member: CurrentMember,
  projectId: string,
  mode: 'read' | 'edit',
) {
  const [row] = await getDb()
    .select({ project: projects, memberRole: shareRoleOf(member.id) })
    .from(projects)
    .where(and(eq(projects.id, projectId), readableBy(member.id)))
    .limit(1);

  if (!row) throw new ApiError(404, 'Project not found.');
  const canEdit = canEditProject(row.project.ownerId, member.id, row.memberRole);
  if (mode === 'edit' && !canEdit) {
    throw new ApiError(403, 'You do not have permission to edit this project.');
  }
  return { ...row, canEdit };
}
