import { SECTION_LABELS, type Section, visibleSettingsSections } from '@/lib/navigation';
import { cn } from '@/lib/utils';

// Team, usage and the activity log, reached from Settings in the header.
export function SettingsTabs({ section, isOwner, onSelect }: { section: Section; isOwner: boolean; onSelect: (section: Section) => void }) {
  return <nav aria-label="Settings" className="mb-6 flex flex-wrap gap-1 border-b border-line">
    {visibleSettingsSections(isOwner).map((item) => <button aria-current={item === section ? 'page' : undefined} className={cn('-mb-px min-h-11 border-b-2 px-3 text-sm', item === section ? 'border-brand-text font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink')} key={item} onClick={() => onSelect(item)} type="button">{SECTION_LABELS[item]}</button>)}
  </nav>;
}
