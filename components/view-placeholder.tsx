import { Folder } from 'lucide-react';

export function ViewPlaceholder({ icon: Icon, title, detail }: { icon: typeof Folder; title: string; detail: string }) {
  return <div className="rounded-2xl border border-dashed border-line-strong bg-surface-veil p-12 text-center"><Icon className="mx-auto mb-3 text-ink-muted" /><p className="font-medium">{title}</p><p className="mt-1 text-sm text-ink-muted">{detail}</p></div>;
}
