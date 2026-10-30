import { Folder } from 'lucide-react';

export function ViewPlaceholder({ icon: Icon, title, detail }: { icon: typeof Folder; title: string; detail: string }) {
  return <div className="rounded-2xl border border-dashed border-black/10 bg-white/50 p-12 text-center"><Icon className="mx-auto mb-3 text-[#6f7b78]" /><p className="font-medium">{title}</p><p className="mt-1 text-sm text-[#75817e]">{detail}</p></div>;
}
