import { Folder } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function MetricCard({ icon: Icon, label, value, detail, accent = false }: { icon: typeof Folder; label: string; value: string; detail: string; accent?: boolean }) {
  return <Card className={cn('border-0 py-4 shadow-none ring-line', accent ? 'bg-surface-selected' : 'bg-surface-raised/80')}><CardContent className="flex items-center gap-4"><span className={cn('grid size-10 place-items-center rounded-xl', accent ? 'bg-brand text-brand-ink' : 'bg-surface-fill text-brand-text')}><Icon className="size-[18px]" /></span><div className="min-w-0"><p className="text-xs font-medium text-ink-muted">{label}</p><p className="mt-0.5 text-xl font-semibold tracking-tight">{value}</p><p className="truncate text-[11px] text-ink-subtle">{detail}</p></div></CardContent></Card>;
}
