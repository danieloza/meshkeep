import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { projects } from '@/db/schema';
import { buildMatchQuery, type ConversationHit, type FileHit, type SearchResults } from '@/lib/search';
import { readableBy, requireProjectAccess } from '@/lib/server/access';
import { requireMember } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

const MAX_RESULTS = 20;
// Several messages of one conversation can match; the extra rows leave room to
// still return MAX_RESULTS distinct conversations.
const MAX_MESSAGE_ROWS = 60;

// Searches conversations and file text across every project the member can
// read, or one project when `projectId` is given. Access is part of the SQL,
// so content from a project the member cannot open never leaves the database.
export async function GET(request: Request) {
  try {
    const member = await requireMember();
    const params = new URL(request.url).searchParams;
    const query = (params.get('q') ?? '').slice(0, 200);
    const projectId = params.get('projectId');
    if (projectId !== null) {
      if (!z.uuid().safeParse(projectId).success) return json({ error: 'Invalid project ID.' }, { status: 400 });
      await requireProjectAccess(member, projectId, 'read');
    }
    // `projects` keeps its own name in the queries below, without an alias,
    // because `readableBy` refers to it by that name.
    const scope = projectId ? eq(projects.id, projectId) : readableBy(member.id);
    const db = getDb();

    // Files waiting for indexing cannot be found yet. Saying how many keeps an
    // empty result from reading as "this is not in any file".
    const [{ n: unindexedFiles }] = await db.all<{ n: number }>(sql`
      SELECT count(*) AS n FROM files f
      JOIN projects ON projects.id = f.project_id
      LEFT JOIN file_texts t ON t.file_id = f.id
      WHERE t.file_id IS NULL AND ${scope}`);

    const match = buildMatchQuery(query);
    if (!match) return json({ conversations: [], files: [], unindexedFiles } satisfies SearchResults);

    const messageRows = await db.all<ConversationHit>(sql`
      SELECT c.id AS conversationId, c.project_id AS projectId, projects.name AS projectName, c.title AS title, m.role AS role,
             snippet(messages_fts, 0, char(2), char(3), '…', 14) AS snippet
      FROM messages_fts
      JOIN messages m ON m.rowid = messages_fts.rowid
      JOIN conversations c ON c.id = m.conversation_id
      JOIN projects ON projects.id = c.project_id
      WHERE messages_fts MATCH ${match} AND ${scope}
      ORDER BY bm25(messages_fts)
      LIMIT ${MAX_MESSAGE_ROWS}`);
    const seen = new Set<string>();
    const conversations = messageRows.filter((row) => !seen.has(row.conversationId) && seen.add(row.conversationId)).slice(0, MAX_RESULTS);

    // A match in the path counts four times a match in the text: a file named
    // after the search term is usually the one being looked for.
    const files = await db.all<FileHit>(sql`
      SELECT f.id AS fileId, f.project_id AS projectId, projects.name AS projectName, f.relative_path AS path,
             snippet(file_texts_fts, -1, char(2), char(3), '…', 14) AS snippet
      FROM file_texts_fts
      JOIN file_texts t ON t.rowid = file_texts_fts.rowid
      JOIN files f ON f.id = t.file_id
      JOIN projects ON projects.id = f.project_id
      WHERE file_texts_fts MATCH ${match} AND ${scope}
      ORDER BY bm25(file_texts_fts, 4.0, 1.0)
      LIMIT ${MAX_RESULTS}`);

    return json({ conversations, files, unindexedFiles } satisfies SearchResults);
  } catch (error) { return errorResponse(error); }
}
