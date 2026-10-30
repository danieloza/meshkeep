'use client';

import { useEffect, useState } from 'react';
import { Loader2, MessageSquareText, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import type { ConversationRow } from '@/lib/contracts/conversations';
import { ViewPlaceholder } from '@/components/view-placeholder';
import { visibilityLabels } from '@/features/projects/project';
import { relativeDate } from '@/lib/format';

export function ConversationsView({ onOpenConversation, onNotice, query }: { onOpenConversation: (projectId: string, conversationId: string) => void; onNotice: (message: string) => void; query: string }) {
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.conversations()
      .then((payload) => { if (active) setRows(payload.conversations); })
      .catch(() => { if (active) setError('Could not load conversations.'); });
    return () => { active = false; };
  }, []);

  // Conversations nie da się odzyskać, a jej tytuł to początek pierwszej messages,
  // więc w potwierdzeniu pokazujemy dokładnie to, co zniknie.
  async function deleteConversation(row: ConversationRow) {
    if (deletingId) return;
    if (!window.confirm(`Delete “${row.title}” with ${row.messageCount} messages? This cannot be undone.`)) return;
    setDeletingId(row.id);
    try {
      await api.projects.removeConversation(row.projectId, row.id);
      setRows((current) => (current ?? []).filter((item) => item.id !== row.id));
      onNotice('Conversation deleted.');
    } catch (caught) { onNotice(caught instanceof Error ? caught.message : 'Could not delete the conversation.'); }
    finally { setDeletingId(null); }
  }

  const needle = query.trim().toLocaleLowerCase('pl');
  const visible = (rows ?? []).filter((row) => !needle || `${row.title} ${row.projectName}`.toLocaleLowerCase('pl').includes(needle));

  if (error) return <ViewPlaceholder detail={error} icon={MessageSquareText} title="Something went wrong" />;
  if (!rows) return <ViewPlaceholder detail="This may take a moment." icon={Loader2} title="Loading conversations…" />;
  if (!rows.length) return <ViewPlaceholder detail="Open a project and send the first message. It will appear here." icon={MessageSquareText} title="No conversations yet" />;
  if (!visible.length) return <ViewPlaceholder detail="Change the search term above." icon={Search} title="No search results" />;

  return <section aria-label="Conversations" className="space-y-2">
    <p className="mb-4 text-sm text-[#75817e]">{visible.length === rows.length ? `${rows.length} ${rows.length === 1 ? 'conversation' : 'conversations'}` : `${visible.length} of ${rows.length} conversations`}</p>
    {visible.map((row) => <div className="flex items-center gap-1 rounded-xl border border-black/7 bg-white/85 pr-2 transition hover:border-black/15 hover:bg-white" key={row.id}>
      <button className="flex min-w-0 flex-1 items-center gap-4 rounded-xl px-4 py-3 text-left" onClick={() => onOpenConversation(row.projectId, row.id)} type="button">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#e6f3ef] text-[#2c5b54]"><MessageSquareText className="size-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{row.title}</span>
          <span className="mt-0.5 block truncate text-[11px] text-[#818b89]">{row.projectName} · {visibilityLabels[row.projectVisibility]} · {row.messageCount} {row.messageCount === 1 ? 'message' : 'messages'}</span>
        </span>
        <span className="shrink-0 text-[11px] text-[#87918f]">{relativeDate(row.updatedAt)}</span>
      </button>
      <Button aria-label={`Delete conversation ${row.title}`} disabled={deletingId === row.id} onClick={() => void deleteConversation(row)} size="icon-sm" title="Delete conversation" variant="ghost"><Trash2 /></Button>
    </div>)}
  </section>;
}
