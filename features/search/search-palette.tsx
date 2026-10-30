'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Folder, MessageSquareText, Search } from 'lucide-react';
import { api } from '@/lib/api-client';
import type { SearchResults } from '@/lib/contracts/search';
import { splitHighlights } from '@/lib/search';
import { cn } from '@/lib/utils';
import { type Project, visibilityLabels } from '@/features/projects/project';

export type SearchTarget = { conversationId?: string; fileId?: string };

const MIN_QUERY = 2;
const MAX_PROJECTS = 4;

function Highlighted({ text }: { text: string }) {
  return <>{splitHighlights(text).map((part, index) => part.hit
    ? <mark className="rounded bg-warn-soft-strong px-0.5 text-ink" key={index}>{part.text}</mark>
    : <span key={index}>{part.text}</span>)}</>;
}

type Entry = { key: string; kind: 'project' | 'conversation' | 'file'; title: string; snippet: string; where: string; open: () => void };

const GROUPS = [
  { kind: 'project' as const, label: 'Projects', icon: Folder },
  { kind: 'conversation' as const, label: 'Conversations', icon: MessageSquareText },
  { kind: 'file' as const, label: 'Files', icon: FileText },
];

// Search over everything the member can open: project names here in the
// browser, conversations and file contents on the server. It opens over the
// page from the header or with Ctrl K, and the keyboard moves through the
// results with the arrows and opens one with Enter.
export function SearchPalette({ projects, onClose, onOpenProject, onOpenResult }: { projects: Project[]; onClose: () => void; onOpenProject: (project: Project) => void; onOpenResult: (projectId: string, target: SearchTarget) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ term: string; data: SearchResults } | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const term = query.trim();

  useEffect(() => {
    // Focus returns to whatever opened the palette when it closes.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    if (term.length < MIN_QUERY) return;
    let current = true;
    const timer = setTimeout(() => {
      api.search(term).then((data) => { if (current) setResults({ term, data }); }).catch(() => undefined);
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [term]);

  // Results for an older term stay on screen while the next ones load, so the
  // list does not flicker on every keystroke.
  const data = term.length >= MIN_QUERY ? results?.data ?? null : null;
  const loading = term.length >= MIN_QUERY && results?.term !== term;

  const entries = useMemo<Entry[]>(() => {
    if (term.length < MIN_QUERY) return [];
    const needle = term.toLocaleLowerCase('pl');
    const projectEntries = projects
      .filter((project) => `${project.name} ${project.description}`.toLocaleLowerCase('pl').includes(needle))
      .slice(0, MAX_PROJECTS)
      .map((project): Entry => ({ key: `p-${project.id}`, kind: 'project', title: project.name, snippet: '', where: `${visibilityLabels[project.visibility]} · ${project.files} ${project.files === 1 ? 'file' : 'files'}`, open: () => onOpenProject(project) }));
    const conversationEntries = (data?.conversations ?? []).map((hit): Entry => ({ key: `c-${hit.conversationId}`, kind: 'conversation', title: hit.title, snippet: hit.snippet, where: hit.projectName, open: () => onOpenResult(hit.projectId, { conversationId: hit.conversationId }) }));
    const fileEntries = (data?.files ?? []).map((hit): Entry => ({ key: `f-${hit.fileId}`, kind: 'file', title: hit.path, snippet: hit.snippet, where: `${hit.projectName} · opens the chat with this file picked`, open: () => onOpenResult(hit.projectId, { fileId: hit.fileId }) }));
    return [...projectEntries, ...conversationEntries, ...fileEntries];
  }, [data, onOpenProject, onOpenResult, projects, term]);

  const selected = Math.min(active, Math.max(entries.length - 1, 0));

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (!entries.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((selected + 1) % entries.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((selected - 1 + entries.length) % entries.length); }
    else if (event.key === 'Enter') { event.preventDefault(); entries[selected].open(); }
  }

  // The active option stays in view as the arrows move through a long list.
  useEffect(() => {
    document.getElementById(`search-option-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const counts = { conversation: data?.conversations.length ?? 0, file: data?.files.length ?? 0 };
  const empty = term.length >= MIN_QUERY && !loading && entries.length === 0;

  return <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 px-4 pb-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section aria-label="Search" aria-modal="true" className="flex max-h-[76vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface-raised shadow-2xl" role="dialog">
      <div className="flex items-center gap-3 border-b border-line py-1.5 pl-4 pr-1.5">
        <Search aria-hidden className="size-4 shrink-0 text-ink-subtle" />
        <input aria-activedescendant={entries.length ? `search-option-${selected}` : undefined} aria-autocomplete="list" aria-controls="search-options" aria-expanded={entries.length > 0} aria-label="Search projects, conversations and file contents" className="min-h-11 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-subtle" onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={onKeyDown} placeholder="Search projects, conversations and file contents" ref={input} role="combobox" type="search" value={query} />
        <button className="min-h-11 rounded-lg px-3 text-sm text-ink-muted hover:bg-surface-fill hover:text-ink" onClick={onClose} type="button">Close</button>
      </div>

      <div className="overflow-y-auto p-2">
        {term.length < MIN_QUERY && <p className="px-2 py-3 text-sm text-ink-muted">Type at least two letters. ↑ and ↓ move through the results, Enter opens one, Esc closes.</p>}
        {entries.length > 0 && <ul aria-label="Search results" className="flex flex-col gap-0.5" id="search-options" role="listbox">
          {GROUPS.map((group) => {
            const items = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.kind === group.kind);
            if (!items.length) return null;
            return <li className="flex flex-col gap-0.5" key={group.kind} role="presentation">
              <p className="px-2 pb-1 pt-2 text-xs font-semibold text-ink-subtle" id={`search-group-${group.kind}`}>{group.label}</p>
              <ul aria-labelledby={`search-group-${group.kind}`} className="flex flex-col gap-0.5" role="group">
                {items.map(({ entry, index }) => <li aria-selected={index === selected} className={cn('flex min-h-11 cursor-pointer gap-2.5 rounded-lg px-2 py-2', index === selected ? 'bg-surface-selected' : 'hover:bg-surface-fill')} id={`search-option-${index}`} key={entry.key} onClick={entry.open} onMouseMove={() => { if (index !== selected) setActive(index); }} role="option">
                  <group.icon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-text" />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm font-medium', entry.kind === 'file' && 'font-mono text-[13px]')}>{entry.title}</span>
                    {entry.snippet && <span className="mt-0.5 line-clamp-2 block text-[13px] leading-5 text-ink-muted"><Highlighted text={entry.snippet} /></span>}
                    <span className="mt-0.5 block truncate text-xs text-ink-subtle">{entry.where}</span>
                  </span>
                </li>)}
              </ul>
            </li>;
          })}
        </ul>}
        {empty && <p className="px-2 py-3 text-sm text-ink-muted">No project, conversation or file contains “{term}”.</p>}
        {loading && entries.length === 0 && <p className="px-2 py-3 text-sm text-ink-muted">Searching…</p>}
      </div>

      <footer className="flex flex-wrap justify-between gap-2 border-t border-line px-4 py-2.5 text-xs text-ink-subtle">
        <span>Only projects you can open are searched.{data && data.unindexedFiles > 0 ? ` ${data.unindexedFiles} ${data.unindexedFiles === 1 ? 'file is not searchable until its project is' : 'files are not searchable until their projects are'} opened.` : ''}</span>
        {data && <span>{counts.conversation} {counts.conversation === 1 ? 'conversation' : 'conversations'} · {counts.file} {counts.file === 1 ? 'file' : 'files'}</span>}
      </footer>
    </section>
  </div>;
}
