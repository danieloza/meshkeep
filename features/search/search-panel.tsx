import { FileText, MessageSquareText } from 'lucide-react';
import type { SearchResults } from '@/lib/contracts/search';
import { splitHighlights } from '@/lib/search';
import { cn } from '@/lib/utils';

function Highlighted({ text }: { text: string }) {
  return <>{splitHighlights(text).map((part, index) => part.hit
    ? <mark className="rounded bg-warn-soft-strong px-0.5 text-ink" key={index}>{part.text}</mark>
    : <span key={index}>{part.text}</span>)}</>;
}

type SearchTarget = { conversationId?: string; fileId?: string };

export const SEARCH_INPUT_ID = 'global-search';

export const SEARCH_RESULTS_ID = 'search-results';

// Focus moving between the search box and its results keeps the panel open,
// so a click or Tab can reach a result; focus going anywhere else closes it.
export function focusStaysInSearch(next: EventTarget | null) {
  return next instanceof Element && (next.id === SEARCH_INPUT_ID || Boolean(next.closest(`#${SEARCH_RESULTS_ID}`)));
}

export function SearchPanel({ results, onOpen, onBlur, onFocus }: { results: SearchResults; onOpen: (projectId: string, target: SearchTarget) => void; onBlur: (next: EventTarget | null) => void; onFocus: () => void }) {
  const empty = !results.conversations.length && !results.files.length;
  return <div className="absolute left-0 right-0 top-12 z-40 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surface-raised p-2 shadow-xl" id={SEARCH_RESULTS_ID} onBlur={(event) => onBlur(event.relatedTarget)} onFocus={onFocus}>
    {results.conversations.length > 0 && <section>
      <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Conversations</p>
      {results.conversations.map((hit) => <button className="block w-full rounded-lg px-2 py-2 text-left hover:bg-surface-fill" key={hit.conversationId} onClick={() => onOpen(hit.projectId, { conversationId: hit.conversationId })} type="button">
        <span className="flex items-center gap-2 text-xs font-medium"><MessageSquareText className="size-3.5 shrink-0 text-brand-text" /><span className="truncate">{hit.title}</span><span className="ml-auto shrink-0 text-[10px] font-normal text-ink-subtle">{hit.projectName}</span></span>
        <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-ink-muted"><Highlighted text={hit.snippet} /></span>
      </button>)}
    </section>}
    {results.files.length > 0 && <section className={cn(results.conversations.length > 0 && 'mt-1 border-t border-line pt-1')}>
      <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Files</p>
      {results.files.map((hit) => <button className="block w-full rounded-lg px-2 py-2 text-left hover:bg-surface-fill" key={hit.fileId} onClick={() => onOpen(hit.projectId, { fileId: hit.fileId })} title="Open the project chat with this file selected" type="button">
        <span className="flex items-center gap-2 text-xs font-medium"><FileText className="size-3.5 shrink-0 text-brand-text" /><span className="truncate">{hit.path}</span><span className="ml-auto shrink-0 text-[10px] font-normal text-ink-subtle">{hit.projectName}</span></span>
        {hit.snippet && <span className="mt-1 line-clamp-2 block text-[11px] leading-4 text-ink-muted"><Highlighted text={hit.snippet} /></span>}
      </button>)}
    </section>}
    {empty && <p className="px-2 py-3 text-xs text-ink-muted">No conversations or files match. Matching project names are filtered below.</p>}
    {results.unindexedFiles > 0 && <p className="mt-1 border-t border-line px-2 pt-2 text-[10px] leading-4 text-ink-subtle">{results.unindexedFiles} {results.unindexedFiles === 1 ? 'file is' : 'files are'} not searchable yet. Opening a project indexes its files.</p>}
  </div>;
}
