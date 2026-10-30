import { Activity, Bot, Folder, ScrollText, LayoutGrid, MessageSquareText, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SECTION_LABELS, type Section, visibleSections } from '@/lib/navigation';
import { cn } from '@/lib/utils';

const SECTION_ICONS: Record<Section, typeof Folder> = {
  dashboard: LayoutGrid,
  projects: Folder,
  conversations: MessageSquareText,
  team: Users,
  usage: Activity,
  activity: ScrollText,
};

export function Sidebar({ open, onClose, fileCount, isOwner, section, onSelect }: { open: boolean; onClose: () => void; fileCount: number; isOwner: boolean; section: Section; onSelect: (section: Section) => void }) {
  const nav = visibleSections(isOwner).map((item) => ({ id: item, label: SECTION_LABELS[item], icon: SECTION_ICONS[item], active: item === section }));
  return <><button aria-label="Close menu" className={cn('fixed inset-0 z-40 bg-black/35 backdrop-blur-sm lg:hidden', open ? 'block' : 'hidden')} onClick={onClose} type="button" /><aside className={cn('fixed inset-y-0 left-0 z-50 flex w-[252px] flex-col border-r border-white/8 bg-brand-deepest px-4 py-5 text-white transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0', open ? 'translate-x-0' : '-translate-x-full')}>
    <div className="mb-8 flex items-center justify-between px-2"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-300 to-emerald-400 text-[#102724]"><Bot className="size-5" /></span><div><p className="font-semibold tracking-tight">MeshKeep</p><p className="text-[11px] text-emerald-100/65">PRIVATE TEAM CLOUD</p></div></div><Button aria-label="Close menu" className="text-white lg:hidden" onClick={onClose} size="icon-sm" variant="ghost"><X /></Button></div>
    <nav aria-label="Main navigation" className="space-y-1">{nav.map((item) => <button key={item.id} aria-current={item.active ? 'page' : undefined} className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors', item.active ? 'bg-white/10 font-medium text-white' : 'text-emerald-50/58 hover:bg-white/6 hover:text-white')} onClick={() => onSelect(item.id)} type="button"><item.icon className="size-[18px]" />{item.label}</button>)}</nav>
    <div className="mt-auto rounded-2xl border border-white/8 bg-white/[0.045] p-4"><div className="mb-2 flex items-center justify-between text-xs"><span className="text-emerald-50/60">Cloud files</span><span className="font-medium">{fileCount}</span></div><p className="text-[11px] leading-4 text-emerald-50/60">Only files you explicitly select are uploaded. Your local Projects folder is not connected.</p></div>
  </aside></>;
}
