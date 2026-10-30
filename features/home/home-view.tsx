'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { api } from '@/lib/api-client';
import type { Visibility } from '@/lib/contracts/common';
import type { ConversationRow } from '@/lib/contracts/conversations';
import { relativeDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type Project, visibilityBadgeClasses, visibilityLabels } from '@/features/projects/project';

const RECENT_CONVERSATIONS = 5;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  return <span className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium', visibilityBadgeClasses[visibility])}><span aria-hidden className="size-1.5 rounded-full bg-current" />{visibilityLabels[visibility]}</span>;
}

// Home: the latest conversations to pick up, then every project. Usage and
// sync now live in Settings, so home holds only what leads back into work.
export function HomeView({ projects, onOpenConversation, onOpenProject, onNewProject, onAllConversations }: { projects: Project[]; onOpenConversation: (projectId: string, conversationId: string) => void; onOpenProject: (project: Project) => void; onNewProject: () => void; onAllConversations: () => void }) {
  const [recent, setRecent] = useState<ConversationRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    // The server lists conversations newest first.
    api.conversations()
      .then((payload) => { if (active) setRecent(payload.conversations.slice(0, RECENT_CONVERSATIONS)); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  return <div className="flex max-w-[880px] flex-col gap-8">
    <section aria-labelledby="home-recent" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold text-ink-muted" id="home-recent">Recent conversations</h2>
        {recent && recent.length > 0 && <button className="min-h-11 px-1 text-sm text-brand-text hover:text-ink" onClick={onAllConversations} type="button">All conversations</button>}
      </div>
      {failed
        ? <p className="rounded-xl border border-line bg-surface-raised p-4 text-sm text-danger-text">Could not load conversations.</p>
        : !recent
          ? <p className="flex items-center gap-2 p-4 text-sm text-ink-muted"><Loader2 className="size-4 animate-spin" /> Loading conversations…</p>
          : recent.length === 0
            ? <p className="rounded-xl border border-dashed border-line-strong p-4 text-sm leading-6 text-ink-muted">No conversations yet. Open a project and ask the first question; it will be waiting here next time.</p>
            : <ul className="overflow-hidden rounded-xl border border-line bg-surface-raised">
              {recent.map((row) => <li className="border-b border-line last:border-b-0" key={row.id}>
                <button className="flex min-h-15 w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-surface-fill" onClick={() => onOpenConversation(row.projectId, row.id)} type="button">
                  <span className="min-w-0 flex-1 basis-60">
                    <span className="block truncate font-medium">{row.title}</span>
                    <span className="block truncate text-xs text-ink-subtle">{row.projectName} · {plural(row.messageCount, 'message', 'messages')}</span>
                  </span>
                  <VisibilityBadge visibility={row.projectVisibility} />
                  <span className="min-w-20 text-right text-xs text-ink-subtle">{relativeDate(row.updatedAt)}</span>
                </button>
              </li>)}
            </ul>}
    </section>

    <section aria-labelledby="home-projects" className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-ink-muted" id="home-projects">Projects</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {projects.map((project) => <button className="flex min-h-[132px] flex-col items-start gap-3 rounded-xl border border-line bg-surface-raised p-4 text-left transition hover:border-line-strong hover:shadow-md" key={project.id} onClick={() => onOpenProject(project)} type="button">
          <VisibilityBadge visibility={project.visibility} />
          <span className="text-[15px] font-semibold tracking-tight">{project.name}</span>
          <span className="mt-auto text-xs text-ink-subtle">{plural(project.files, 'file', 'files')} · {plural(project.conversations, 'conversation', 'conversations')} · {project.updated}</span>
        </button>)}
        <button className="flex min-h-[132px] flex-col items-start justify-center gap-2 rounded-xl border border-dashed border-line-strong p-4 text-left text-sm text-ink-muted transition hover:border-brand-text hover:text-ink" onClick={onNewProject} type="button">
          <Plus className="size-4" />
          <span className="font-medium">{projects.length ? 'New project' : 'Create your first project'}</span>
          <span className="text-xs leading-5 text-ink-subtle">Start empty or import a folder or ZIP archive.</span>
        </button>
      </div>
    </section>
  </div>;
}
