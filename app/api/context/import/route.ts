import { getDb } from '@/db';
import { conversations, messages, projects } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { normalizeContextFile } from '@/lib/server/context-import';
import { ApiError, assertSameOrigin, errorResponse, json } from '@/lib/server/http';

const MAX_CONTEXT_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_CONTEXT_BYTES + 100_000) throw new ApiError(413, 'A context file can be up to 5 MB.');
    const member = await requireMember();
    const form = await request.formData();
    const file = form.get('context');
    if (!(file instanceof File) || file.size <= 0 || file.size > MAX_CONTEXT_BYTES || !file.name.toLocaleLowerCase('en-US').endsWith('.json')) throw new ApiError(400, 'Select a JSON context file up to 5 MB.');
    let raw: unknown;
    try { raw = JSON.parse(await file.text()); } catch { throw new ApiError(400, 'The file does not contain valid JSON.'); }
    const imported = normalizeContextFile(raw);
    const requestedName = form.get('name');
    const nameInput = (typeof requestedName === 'string' ? requestedName : file.name.replace(/\.json$/i, '')).trim();
    const name = nameInput.slice(0, 80) || 'Imported context';
    const projectId = crypto.randomUUID();
    const now = new Date();
    const db = getDb();
    await db.insert(projects).values({ id: projectId, ownerId: member.id, name, description: `Import kontekstu: ${file.name.slice(0, 120)}`, visibility: 'private', createdAt: now, updatedAt: now });
    for (const importedConversation of imported) {
      const conversationId = crypto.randomUUID();
      await db.insert(conversations).values({ id: conversationId, projectId, createdBy: member.id, title: importedConversation.title, createdAt: now, updatedAt: now });
      const rows = importedConversation.messages.map((message, index) => ({ id: crypto.randomUUID(), conversationId, memberId: message.role === 'user' ? member.id : null, role: message.role, content: message.content, createdAt: new Date(now.getTime() + index) }));
      if (rows.length) await db.insert(messages).values(rows);
    }
    return json({ project: { id: projectId, name, visibility: 'private', conversations: imported.length }, message: `Zaimportowano ${imported.length} conversations.` }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
