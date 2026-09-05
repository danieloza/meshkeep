import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { conversations, messages } from '@/db/schema';
import { requireMember } from '@/lib/server/auth';
import { recordAudit } from '@/lib/server/audit';
import { assertSameOrigin, errorResponse, json } from '@/lib/server/http';
import { requireProjectAccess } from '@/lib/server/projects';

export const dynamic = 'force-dynamic';

const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 200;

// Conversations były dotąd zapisywane, ale nigdy nieodczytywane: odświeżenie strony
// kasowało historię z widoku, a jedynym sposobem, żeby ją zobaczyć, był eksport
// kontekstu do pliku.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const member = await requireMember();
    const { id } = await context.params;
    await requireProjectAccess(member, id, 'read');
    const db = getDb();

    const requested = new URL(request.url).searchParams.get('conversationId');
    if (requested !== null) {
      const parsed = z.uuid().safeParse(requested);
      if (!parsed.success) return json({ error: 'Invalid conversation ID.' }, { status: 400 });
      const [conversation] = await db
        .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
        .from(conversations)
        .where(and(eq(conversations.id, parsed.data), eq(conversations.projectId, id)))
        .limit(1);
      if (!conversation) return json({ error: 'Conversation not found.' }, { status: 404 });
      const rows = await db
        .select({ role: messages.role, content: messages.content, model: messages.model, createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.conversationId, conversation.id))
        .orderBy(asc(messages.createdAt))
        .limit(MAX_MESSAGES);
      return json({ conversation, messages: rows });
    }

    const rows = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        updatedAt: conversations.updatedAt,
        messageCount: sql<number>`(select count(*) from ${messages} where ${messages.conversationId} = ${conversations.id})`,
      })
      .from(conversations)
      .where(eq(conversations.projectId, id))
      .orderBy(desc(conversations.updatedAt))
      .limit(MAX_CONVERSATIONS);
    return json({ conversations: rows });
  } catch (error) { return errorResponse(error); }
}

// Kasowanie rozmowy. Wiadomosci znikaja same przez `ON DELETE CASCADE`.
//
// Uprawnienie jest WEZSZE niz przy plikach i to jest swiadome. Tam argumentem
// bylo, ze wysylka pliku o tej samej sciezce juz wczesniej niszczyla cudzy plik,
// wiec przycisk niczego nie poszerzal. Przy rozmowach nie ma zadnej sciezki
// nadpisania, wiec ten argument nie przenosi sie: edytor projektu nie kasuje
// cudzej historii czatu. Moze to zrobic autor rozmowy albo wlasciciel projektu.
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const member = await requireMember();
    const { id } = await context.params;
    const access = await requireProjectAccess(member, id, 'read');

    const requested = new URL(request.url).searchParams.get('conversationId');
    const parsed = z.uuid().safeParse(requested);
    if (!parsed.success) return json({ error: 'Invalid conversation ID.' }, { status: 400 });

    const db = getDb();
    // Wlasciciel projektu siega po kazda rozmowe w swoim projekcie; kazdy inny
    // wylacznie po wlasna. Warunek autorstwa dokladamy do zapytania, a nie
    // sprawdzamy po pobraniu, zeby nie istniala sciezka, ktora cudza rozmowa
    // wychodzi z bazy przed sprawdzeniem praw.
    const isProjectOwner = access.project.ownerId === member.id;
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(
        eq(conversations.id, parsed.data),
        eq(conversations.projectId, id),
        ...(isProjectOwner ? [] : [eq(conversations.createdBy, member.id)]),
      ))
      .limit(1);
    if (!conversation) return json({ error: 'The conversation was not found or you cannot delete it.' }, { status: 404 });

    const [{ value: messageCount }] = await db
      .select({ value: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.conversationId, conversation.id));
    await db.delete(conversations).where(eq(conversations.id, conversation.id));

    // Tytul rozmowy to pierwsze 80 znakow wiadomosci uzytkownika, czyli wprost
    // tresc promptu. Dziennik ma zasade "bez tresci rozmow", wiec do wpisu idzie
    // nazwa projektu i identyfikator, nigdy tytul.
    await recordAudit({
      actorId: member.id,
      actorLabel: member.displayName,
      action: 'conversation.deleted',
      targetType: 'conversation',
      targetId: conversation.id,
      targetLabel: access.project.name,
      detail: { wiadomosci: messageCount },
    });
    return json({ deleted: true });
  } catch (error) { return errorResponse(error); }
}
