import { asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { conversations, files, messages } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { errorResponse } from '@/lib/server/http';
import { requireProjectAccess } from '@/lib/server/projects';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember();
    const { id } = await context.params;
    const access = await requireProjectAccess(member, id, 'read');
    const db = getDb();
    const chats = await db.select().from(conversations).where(eq(conversations.projectId, id)).orderBy(asc(conversations.createdAt));
    const chatMessages = chats.length ? await db.select().from(messages).where(inArray(messages.conversationId, chats.map((chat) => chat.id))).orderBy(asc(messages.createdAt)) : [];
    const manifest = await db.select({ relativePath: files.relativePath, mimeType: files.mimeType, sizeBytes: files.sizeBytes, sha256: files.sha256 }).from(files).where(eq(files.projectId, id));
    const payload = { format: 'meshkeep-context', version: 1, exportedAt: new Date().toISOString(), project: { name: access.project.name, description: access.project.description, visibility: access.project.visibility }, conversations: chats.map((chat) => ({ title: chat.title, messages: chatMessages.filter((message) => message.conversationId === chat.id).map((message) => ({ role: message.role, content: message.content, model: message.model })) })), files: manifest };
    const safeName = access.project.name.replace(/[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ_-]+/g, '-').slice(0, 70) || 'project';
    return new Response(JSON.stringify(payload, null, 2), { headers: { 'Cache-Control': 'no-store, private', 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${safeName}-context.json"`, 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return errorResponse(error); }
}
