import { requireMember } from '@/lib/server/auth';
import { assertSameOrigin, errorResponse, json } from '@/lib/server/http';
import { requireProjectAccess } from '@/lib/server/projects';
import { indexPendingFiles } from '@/lib/server/search-index';

export const dynamic = 'force-dynamic';

// One bounded indexing round for a project. The browser calls it when a
// project is opened and after an import, and repeats while files remain.
// Anyone who can read the project may run it: it only derives searchable text
// from files that person can already open.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const { id } = await context.params;
    await requireProjectAccess(member, id, 'read');
    return json(await indexPendingFiles(id));
  } catch (error) { return errorResponse(error); }
}
