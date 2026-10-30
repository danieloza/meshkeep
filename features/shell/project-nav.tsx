import { LayoutGrid, MessageSquareText, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Visibility } from '@/lib/contracts/common';
import type { ConversationSummary } from '@/lib/contracts/conversations';
import { relativeDate } from '@/lib/format';
import type { Section } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import type { Project } from '@/features/projects/project';
import type { TeamCapacity } from '@/features/team/team-panel';

const VISIBILITY_DOT: Record<Visibility, string> = { private: 'bg-private-text', selected: 'bg-people-text', team: 'bg-team-text' };
const VISIBILITY_SHORT: Record<Visibility, string> = { private: 'Private', selected: 'Shared', team: 'Team' };

// The left column: home, every conversation, and the projects. The open
// project lists its own conversations underneath it. Below the large layout
// the column is a drawer opened from the header.
export function ProjectNav({ open, onClose, section, onSelectSection, projects, activeProjectId, conversations, conversationsLoading, currentConversationId, onOpenProject, onOpenConversation, onNewConversation, onNewProject, teamCapacity, syncEnabled }: {
  open: boolean;
  onClose: () => void;
  section: Section;
  onSelectSection: (section: Section) => void;
  projects: Project[];
  activeProjectId: string | null;
  conversations: ConversationSummary[];
  conversationsLoading: boolean;
  currentConversationId: string | undefined;
  onOpenProject: (project: Project) => void;
  onOpenConversation: (project: Project, conversationId: string) => void;
  onNewConversation: (project: Project) => void;
  onNewProject: () => void;
  teamCapacity: TeamCapacity;
  syncEnabled: boolean;
}) {
  const views = [
    { id: 'dashboard' as const, label: 'Home', icon: LayoutGrid },
    { id: 'conversations' as const, label: 'All conversations', icon: MessageSquareText },
  ];
  return <>
    <button aria-label="Close menu" className={cn('fixed inset-0 z-40 bg-black/35 backdrop-blur-sm lg:hidden', open ? 'block' : 'hidden')} onClick={onClose} type="button" />
    <nav aria-label="Projects" className={cn('fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col gap-0.5 overflow-y-auto border-r border-line bg-surface p-3 transition-transform lg:sticky lg:top-16 lg:z-auto lg:h-[calc(100dvh-4rem)] lg:w-auto lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
      <div className="flex justify-end lg:hidden"><Button aria-label="Close menu" onClick={onClose} size="icon-sm" variant="ghost"><X /></Button></div>
      {views.map((view) => {
        const current = !activeProjectId && section === view.id;
        return <button aria-current={current ? 'page' : undefined} className={cn('flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm', current ? 'bg-surface-selected font-medium text-brand-text' : 'text-ink-muted hover:bg-surface-fill hover:text-ink')} key={view.id} onClick={() => onSelectSection(view.id)} type="button"><view.icon className="size-4" />{view.label}</button>;
      })}

      <div className="mt-4 flex items-center justify-between pl-2.5">
        <h2 className="text-xs font-semibold text-ink-subtle">Projects</h2>
        <div className="flex items-center">
          <Button aria-current={!activeProjectId && section === 'projects' ? 'page' : undefined} className="text-xs text-ink-muted" onClick={() => onSelectSection('projects')} size="sm" variant="ghost">All</Button>
          <Button aria-label="New project" onClick={onNewProject} size="icon" variant="ghost"><Plus /></Button>
        </div>
      </div>
      {projects.length === 0 && <p className="px-2.5 py-2 text-xs leading-5 text-ink-subtle">No projects yet. Create one to start a conversation.</p>}
      {projects.map((project) => {
        const expanded = project.id === activeProjectId;
        return <div className="flex flex-col" key={project.id}>
          <button aria-expanded={expanded} className={cn('flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm hover:bg-surface-fill', expanded && 'font-semibold')} onClick={() => onOpenProject(project)} type="button">
            <span aria-hidden className={cn('size-2 shrink-0 rounded-full', VISIBILITY_DOT[project.visibility])} />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            <span className="text-xs font-normal text-ink-subtle">{VISIBILITY_SHORT[project.visibility]}</span>
          </button>
          {expanded && <div className="flex flex-col gap-0.5 pb-2 pl-5">
            {conversationsLoading && conversations.length === 0 && <p className="px-2.5 py-2 text-xs text-ink-subtle">Loading conversations…</p>}
            {conversations.map((conversation) => {
              const current = conversation.id === currentConversationId;
              return <button aria-current={current ? 'page' : undefined} className={cn('flex min-h-11 w-full flex-col justify-center rounded-lg px-2.5 py-1 text-left', current ? 'bg-surface-selected text-brand-text' : 'hover:bg-surface-fill')} key={conversation.id} onClick={() => onOpenConversation(project, conversation.id)} type="button">
                <span className="w-full truncate text-[13px]">{conversation.title}</span>
                <span className="text-xs text-ink-subtle">{conversation.messageCount} {conversation.messageCount === 1 ? 'message' : 'messages'} · {relativeDate(conversation.updatedAt)}</span>
              </button>;
            })}
            <button aria-current={!currentConversationId ? 'page' : undefined} className={cn('flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px]', !currentConversationId ? 'bg-surface-selected text-brand-text' : 'text-ink-muted hover:bg-surface-fill hover:text-ink')} onClick={() => onNewConversation(project)} type="button"><Plus className="size-3.5" />New conversation</button>
          </div>}
        </div>;
      })}

      <div className="mt-auto flex flex-col gap-2 border-t border-line px-2.5 pt-4 text-xs text-ink-subtle">
        <span>{teamCapacity.used} of {teamCapacity.total} team seats</span>
        <span className="flex items-center gap-2"><span aria-hidden className={cn('size-2 rounded-full', syncEnabled ? 'bg-ok-text' : 'bg-ink-subtle')} />{syncEnabled ? 'Folder sync on' : 'Folder sync off'}</span>
      </div>
    </nav>
  </>;
}
