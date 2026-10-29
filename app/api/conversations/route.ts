import { desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { conversations, messages, projects } from '@/db/schema';
import { readableBy } from '@/lib/server/access';
import { requireMember } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

const MAX_CONVERSATIONS = 200;

// Conversations ze wszystkich projektów, do których członek ma dostęp. Warunek
// widoczności to `readableBy`, ten sam co w `GET /api/projects`. Filtrujemy
// w SQL, a nie po pobraniu, żeby nie było ścieżki, którą cudza rozmowa
// wychodzi z bazy.
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
      .where(readableBy(member.id))
      .orderBy(desc(conversations.updatedAt))
      .limit(MAX_CONVERSATIONS);
    return json({ conversations: rows });
  } catch (error) { return errorResponse(error); }
}
