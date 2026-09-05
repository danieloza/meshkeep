import { and, desc, eq, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { conversations, messages, projectMembers, projects } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

const MAX_CONVERSATIONS = 200;

// Conversations ze wszystkich projektów, do których członek ma dostęp. Warunek
// widoczności jest ten sam co w `GET /api/projects`: własny projekt, projekt
// zespołowy albo jawne udostępnienie. Filtrujemy w SQL, a nie po pobraniu,
// żeby nie było ścieżki, którą cudza rozmowa wychodzi z bazy.
export async function GET() {
  try {
    const member = await requireMember();
    const rows = await getDb()
      .select({
        id: conversations.id,
        title: conversations.title,
        updatedAt: conversations.updatedAt,
        projectId: projects.id,
        projectName: projects.name,
        projectVisibility: projects.visibility,
        messageCount: sql<number>`(select count(*) from ${messages} where ${messages.conversationId} = ${conversations.id})`,
      })
      .from(conversations)
      .innerJoin(projects, eq(projects.id, conversations.projectId))
      .leftJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.memberId, member.id)))
      .where(or(eq(projects.ownerId, member.id), eq(projects.visibility, 'team'), eq(projectMembers.memberId, member.id)))
      .orderBy(desc(conversations.updatedAt))
      .limit(MAX_CONVERSATIONS);
    return json({ conversations: rows });
  } catch (error) { return errorResponse(error); }
}
