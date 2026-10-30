'use client';

import { useEffect, useMemo, useState } from 'react';
import { ScrollText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { AUDIT_LABELS, type AuditAction, isSensitiveAction } from '@/lib/audit';
import type { AuditEvent } from '@/lib/contracts/admin';
import { cn } from '@/lib/utils';
import { ViewPlaceholder } from '@/components/view-placeholder';
import { BackupCard } from '@/features/owner/owner-controls';

// Szczegoly przychodza jako JSON zapisany przez `serializeDetail` - zawsze
// plaski obiekt prostych wartosci. Renderujemy je po ludzku, ale gdyby kiedys
// przyszlo cos innego, pokazujemy surowy napis zamiast wywracac widok.
function AuditDetail({ detail }: { detail: string }) {
  let pary: Array<[string, string]> = [];
  try {
    const parsed: unknown = JSON.parse(detail);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      pary = Object.entries(parsed as Record<string, unknown>).map(([klucz, wartosc]) => [klucz.replaceAll('_', ' '), String(wartosc)]);
    }
  } catch { pary = []; }
  if (!pary.length) return <span className="font-mono">{detail}</span>;
  return <>{pary.map(([klucz, wartosc], index) => <span key={klucz}>{index > 0 && ' · '}{klucz}: <b className="font-medium text-ink-soft">{wartosc}</b></span>)}</>;
}

export function AuditView({ onNotice }: { onNotice: (message: string) => void }) {
  const [rows, setRows] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtrAkcji, setFiltrAkcji] = useState('wszystkie');
  const [filtrAutora, setFiltrAutora] = useState('wszyscy');

  useEffect(() => {
    let active = true;
    api.admin.audit()
      .then((payload) => { if (active) setRows(payload.events); })
      .catch(() => { if (active) setError('Could not load the activity log.'); });
    return () => { active = false; };
  }, []);

  // Listy do filtrów budujemy z tego, co naprawdę jest w dzienniku. Wypisanie
  // wszystkich możliwych akcji dawałoby pozycje, które nic nie wybierają.
  const obecneAkcje = useMemo(() => [...new Set((rows ?? []).map((row) => row.action))].sort(), [rows]);
  const obecniAutorzy = useMemo(() => [...new Set((rows ?? []).map((row) => row.actorLabel))].sort((a, b) => a.localeCompare(b, 'pl')), [rows]);

  const widoczne = (rows ?? []).filter((row) => {
    if (filtrAutora !== 'wszyscy' && row.actorLabel !== filtrAutora) return false;
    if (filtrAkcji === 'wszystkie') return true;
    if (filtrAkcji === 'wrazliwe') return isSensitiveAction(row.action);
    return row.action === filtrAkcji;
  });

  if (error) return <ViewPlaceholder detail={error} icon={ScrollText} title="Something went wrong" />;
  if (!rows) return <ViewPlaceholder detail="This may take a moment." icon={Loader2} title="Loading activity log…" />;
  if (!rows.length) return <><BackupCard onNotice={onNotice} /><div className="pt-2"><ViewPlaceholder detail="Invitations, suspensions, limit changes and file or project deletions appear here." icon={ScrollText} title="The activity log is empty" /></div></>;

  const klasaPola = 'h-8 rounded-lg border border-line-strong bg-surface-raised px-2 text-xs outline-none focus:ring-2 focus:ring-[#4d8b80]/30';

  return <section aria-label="Activity log" className="space-y-2">
    <BackupCard onNotice={onNotice} />
    <div className="flex flex-wrap items-center gap-2 pt-4">
      <label className="text-xs text-ink-muted" htmlFor="activity-event">Event</label>
      <select className={klasaPola} id="activity-event" onChange={(event) => setFiltrAkcji(event.target.value)} value={filtrAkcji}>
        <option value="wszystkie">All</option>
        <option value="wrazliwe">Access-revoking only</option>
        {obecneAkcje.map((akcja) => <option key={akcja} value={akcja}>{AUDIT_LABELS[akcja as AuditAction] ?? akcja}</option>)}
      </select>
      <label className="ml-2 text-xs text-ink-muted" htmlFor="activity-actor">Actor</label>
      <select className={klasaPola} id="activity-actor" onChange={(event) => setFiltrAutora(event.target.value)} value={filtrAutora}>
        <option value="wszyscy">Wszyscy</option>
        {obecniAutorzy.map((autor) => <option key={autor} value={autor}>{autor}</option>)}
      </select>
      {(filtrAkcji !== 'wszystkie' || filtrAutora !== 'wszyscy') && <Button className="h-8 text-xs" onClick={() => { setFiltrAkcji('wszystkie'); setFiltrAutora('wszyscy'); }} size="sm" variant="ghost">Clear filters</Button>}
    </div>
    <p className="pb-2 text-sm text-ink-muted">{widoczne.length === rows.length ? `${rows.length} ${rows.length === 1 ? 'event' : 'events'} · newest first` : `${widoczne.length} of ${rows.length} events`}</p>
    {widoczne.length === 0
      ? <p className="rounded-xl border border-line bg-surface-raised/85 px-4 py-6 text-center text-sm text-ink-muted">No events match the selected filters.</p>
      : widoczne.map((row) => {
      const wazne = isSensitiveAction(row.action);
      return <div className={cn('flex items-start gap-3 rounded-xl border px-4 py-3', wazne ? 'border-red-800/10 bg-danger-soft/70' : 'border-line bg-surface-raised/85')} key={row.id}>
        <span className={cn('mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg', wazne ? 'bg-danger-soft-strong text-danger-text' : 'bg-surface-fill text-brand-text')}><ScrollText className="size-3.5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{AUDIT_LABELS[row.action as AuditAction] ?? row.action}</p>
          <p className="mt-0.5 text-[11px] text-ink-subtle">
            {row.actorLabel}
            {row.targetLabel && <> · {row.targetLabel}</>}
            {row.detail && <> · <AuditDetail detail={row.detail} /></>}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-ink-subtle">{new Date(row.createdAt).toLocaleString('pl-PL')}</span>
      </div>;
    })}
  </section>;
}
