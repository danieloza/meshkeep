import { Folder } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function MetricCard({ icon: Icon, label, value, detail, accent = false }: { icon: typeof Folder; label: string; value: string; detail: string; accent?: boolean }) {
  return <Card className={cn('border-0 py-4 shadow-none ring-black/6', accent ? 'bg-[#dff4ed]' : 'bg-white/80')}><CardContent className="flex items-center gap-4"><span className={cn('grid size-10 place-items-center rounded-xl', accent ? 'bg-[#173d38] text-white' : 'bg-[#eef0ed] text-[#42645e]')}><Icon className="size-[18px]" /></span><div className="min-w-0"><p className="text-xs font-medium text-[#75817e]">{label}</p><p className="mt-0.5 text-xl font-semibold tracking-tight">{value}</p><p className="truncate text-[11px] text-[#87918f]">{detail}</p></div></CardContent></Card>;
}
