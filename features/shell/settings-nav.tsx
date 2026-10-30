import { ArrowLeft } from 'lucide-react';
import { SECTION_LABELS, type Section, visibleSettingsSections } from '@/lib/navigation';
import { cn } from '@/lib/utils';

// The Settings page's own column, in place of the projects. Below the large
// layout it becomes a row of sections above the content.
export function SettingsNav({ section, isOwner, onSelect, onBack }: { section: Section; isOwner: boolean; onSelect: (section: Section) => void; onBack: () => void }) {
  return <nav aria-label="Settings sections" className="flex flex-wrap items-center gap-1 border-b border-line p-3 lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:flex-col lg:flex-nowrap lg:items-stretch lg:overflow-y-auto lg:border-b-0 lg:border-r">
    <button className="flex min-h-11 items-center gap-2 rounded-lg px-2.5 text-left text-sm text-ink-muted hover:bg-surface-fill hover:text-ink" onClick={onBack} type="button"><ArrowLeft className="size-4" />Back to workspace</button>
    <h2 className="hidden px-2.5 pb-1 pt-4 text-xs font-semibold text-ink-subtle lg:block">Settings</h2>
    {visibleSettingsSections(isOwner).map((item) => <button aria-current={item === section ? 'page' : undefined} className={cn('flex min-h-11 items-center rounded-lg px-2.5 text-left text-sm', item === section ? 'bg-surface-selected font-medium text-brand-text' : 'text-ink-muted hover:bg-surface-fill hover:text-ink')} key={item} onClick={() => onSelect(item)} type="button">{SECTION_LABELS[item]}</button>)}
  </nav>;
}
