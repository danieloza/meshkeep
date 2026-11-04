import type { LucideIcon } from 'lucide-react';
import { type FigureMount, LineFigure } from '@/components/line-figure';

type Look = { icon: LucideIcon; figure?: never } | { figure: FigureMount; icon?: never };

// A view with nothing to show. An empty list gets a line figure on the open
// page; loading, errors and refusals keep a small icon in a dashed box, since
// they are passing states rather than a place to start from.
export function ViewPlaceholder({ icon: Icon, figure, title, detail }: Look & { title: string; detail: string }) {
  if (figure) return <div className="flex flex-col items-center px-6 pt-4 pb-10 text-center">
    <LineFigure className="w-56 max-w-full" figure={figure} />
    <p className="mt-1 font-medium">{title}</p>
    <p className="mt-1 max-w-sm text-sm leading-6 text-ink-muted">{detail}</p>
  </div>;
  return <div className="rounded-2xl border border-dashed border-line-strong bg-surface-veil p-12 text-center">{Icon && <Icon className="mx-auto mb-3 text-ink-muted" />}<p className="font-medium">{title}</p><p className="mt-1 text-sm text-ink-muted">{detail}</p></div>;
}
