import { ListFilter } from 'lucide-react';

// A small text filter for a list on the page. Searching contents across
// projects is the search palette's job; this only narrows what is shown.
export function FilterInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="relative block w-full sm:max-w-xs">
    <span className="sr-only">{label}</span>
    <ListFilter aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
    <input className="h-10 w-full rounded-xl border border-line-strong bg-surface-raised pl-9 pr-3 text-sm outline-none placeholder:text-ink-subtle focus:border-ring" onChange={(event) => onChange(event.target.value)} placeholder="Filter" type="search" value={value} />
  </label>;
}
