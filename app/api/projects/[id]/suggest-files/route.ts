import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { buildSuggestQuery } from '@/lib/search';
import { requireMember } from '@/lib/server/auth';
import { errorResponse, json } from '@/lib/server/http';
import { requireProjectAccess } from '@/lib/server/projects';

export const dynamic = 'force-dynamic';

const MAX_SUGGESTIONS = 5;

// Files in this project that look relevant to a question. Only a suggestion:
// nothing here adds a file to the model context. The person still chooses.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember();
    const { id } = await context.params;
    await requireProjectAccess(member, id, 'read');
    const match = buildSuggestQuery((new URL(request.url).searchParams.get('q') ?? '').slice(0, 2_000));
    if (!match) return json({ files: [] });

    const files = await getDb().all<{ fileId: string; path: string; snippet: string }>(sql`
      SELECT f.id AS fileId, f.relative_path AS path,
             snippet(file_texts_fts, -1, char(2), char(3), '…', 10) AS snippet
      FROM file_texts_fts
      JOIN file_texts t ON t.rowid = file_texts_fts.rowid
      JOIN files f ON f.id = t.file_id
      WHERE file_texts_fts MATCH ${match} AND f.project_id = ${id}
      ORDER BY bm25(file_texts_fts, 4.0, 1.0)
      LIMIT ${MAX_SUGGESTIONS}`);
    return json({ files });
  } catch (error) { return errorResponse(error); }
}
