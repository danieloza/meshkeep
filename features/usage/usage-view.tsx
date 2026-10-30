'use client';

import { useEffect, useState } from 'react';
import { Activity, Bot, Gauge, Loader2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import type { UsageResponse } from '@/lib/contracts/usage';
import { cn } from '@/lib/utils';
import { MetricCard } from '@/components/metric-card';
import { ViewPlaceholder } from '@/components/view-placeholder';
import { formatTokens } from '@/lib/format';
import { MemberLimits } from '@/features/usage/member-limits';

export function UsageView({ dailyLimit, monthlyLimit, onNotice }: { dailyLimit: number; monthlyLimit: number; onNotice: (message: string) => void }) {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The member whose limits are open for editing, one at a time.
  const [editing, setEditing] = useState<string | null>(null);

  // After a limit changes, the rows show the new limit and its share.
  function reload() {
    api.usage().then(setData).catch(() => onNotice('Could not refresh usage.'));
  }

  useEffect(() => {
    let active = true;
    api.usage()
      .then((payload) => { if (active) setData(payload); })
      .catch(() => { if (active) setError('Could not load usage.'); });
    return () => { active = false; };
  }, []);

  if (error) return <ViewPlaceholder detail={error} icon={Activity} title="Something went wrong" />;
  if (!data) return <ViewPlaceholder detail="This may take a moment." icon={Loader2} title="Loading usage…" />;

  const todayTotal = data.today.inputTokens + data.today.outputTokens;
  const monthTotal = data.month.inputTokens + data.month.outputTokens;
  const effectiveDaily = data.limits.dailyTokens || dailyLimit;
  const effectiveMonthly = data.limits.monthlyTokens || monthlyLimit;
  // Skala słupków względem najintensywniejszego dnia — bez tego jeden wyjątkowy
  // dzień spłaszczyłby resztę do niewidoczności.
  const peak = data.byDay.reduce((max, row) => Math.max(max, row.inputTokens + row.outputTokens), 0);

  return <section aria-label="Usage and limits" className="space-y-6">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard accent detail={`${effectiveDaily ? Math.round((todayTotal / effectiveDaily) * 100) : 0}% of the daily limit`} icon={Gauge} label="Today" value={formatTokens(todayTotal)} />
      <MetricCard detail={`${effectiveMonthly ? Math.round((monthTotal / effectiveMonthly) * 100) : 0}% of the monthly limit`} icon={Activity} label="This month" value={formatTokens(monthTotal)} />
      <MetricCard detail="requests today" icon={Bot} label="Requests" value={String(data.today.requests)} />
      <MetricCard detail={data.limits.enabled ? 'API access enabled' : 'API access disabled'} icon={ShieldCheck} label="Status" value={data.limits.enabled ? 'Active' : 'Paused'} />
    </div>

    {data.team.length > 0 && <Card className="border-0 bg-surface-raised/90 shadow-none ring-line">
      <CardHeader>
        <CardTitle className="text-base">Team usage</CardTitle>
        <CardDescription>Monthly usage per person against their monthly limit. A limit stops new questions until the next day or month. Numbers only; conversation titles and contents are excluded.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">{data.team.map((row) => {
          const limit = row.monthlyTokens ?? 0;
          const udzial = limit ? Math.min(100, Math.round((row.monthTokens / limit) * 100)) : 0;
          // Wyróżniamy dopiero powyżej 80%: niżej pasek i tak wszystko pokazuje,
          // a kolorowanie wszystkiego odbiera kolorowi znaczenie.
          const blisko = limit > 0 && udzial >= 80;
          return <div className="rounded-xl bg-surface-fill px-3 py-2.5" key={row.memberId}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-semibold">{row.displayName}</span>
                {row.role === 'owner' && <Badge className="border-[#387267]/15 bg-surface-selected px-1.5 py-0 text-[9px] text-brand-text" variant="outline">owner</Badge>}
                {row.status === 'suspended' && <Badge className="border-red-800/15 bg-danger-soft px-1.5 py-0 text-[9px] text-danger-text" variant="outline">suspended</Badge>}
                {row.apiEnabled === false && <Badge className="border-amber-800/15 bg-warn-soft px-1.5 py-0 text-[9px] text-warn-text" variant="outline">API disabled</Badge>}
              </div>
              <div className="flex shrink-0 items-center gap-4 text-right tabular-nums">
                <div><p className="text-[10px] text-ink-subtle">Today</p><p className="font-medium">{formatTokens(row.todayTokens)}</p></div>
                <div><p className="text-[10px] text-ink-subtle">Month</p><p className={cn('font-medium', blisko && 'text-danger-text')}>{formatTokens(row.monthTokens)}</p></div>
                <div><p className="text-[10px] text-ink-subtle">Requests</p><p className="font-medium">{row.monthRequests}</p></div>
                <Button aria-controls={`limits-${row.memberId}`} aria-expanded={editing === row.memberId} onClick={() => setEditing((current) => current === row.memberId ? null : row.memberId)} size="sm" variant="ghost">Edit limit</Button>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-track"><span className={cn('block h-full rounded-full', blisko ? 'bg-danger-text' : 'bg-brand-text')} style={{ width: `${udzial}%` }} /></span>
              <span className="shrink-0 text-[10px] tabular-nums text-ink-subtle">{limit ? `${udzial}% of ${formatTokens(limit)}` : 'no limit'}</span>
            </div>
            {editing === row.memberId && <div id={`limits-${row.memberId}`}><MemberLimits apiEnabled={row.apiEnabled} dailyTokens={row.dailyTokens} displayName={row.displayName} memberId={row.memberId} monthlyTokens={row.monthlyTokens} onNotice={onNotice} onSaved={reload} /></div>}
          </div>;
        })}</div>
      </CardContent>
    </Card>}

    <Card className="border-0 bg-surface-raised/90 shadow-none ring-line">
      <CardHeader><CardTitle className="text-base">Last {data.historyDays} days</CardTitle><CardDescription>Daily input and output token totals.</CardDescription></CardHeader>
      <CardContent>
        {data.byDay.length === 0
          ? <p className="text-sm text-ink-muted">No usage was recorded during this period.</p>
          : <div className="space-y-1.5">{data.byDay.map((row) => { const total = row.inputTokens + row.outputTokens; return <div className="flex items-center gap-3 text-xs" key={row.day}>
              <span className="w-20 shrink-0 tabular-nums text-ink-subtle">{row.day.slice(5)}</span>
              <span className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-fill"><span className="block h-full rounded-full bg-[#2c766a]" style={{ width: `${peak ? Math.max(2, Math.round((total / peak) * 100)) : 0}%` }} /></span>
              <span className="w-20 shrink-0 text-right tabular-nums font-medium">{formatTokens(total)}</span>
              <span className="w-16 shrink-0 text-right tabular-nums text-ink-subtle">{row.requests} zap.</span>
            </div>; })}</div>}
      </CardContent>
    </Card>

    <Card className="border-0 bg-surface-raised/90 shadow-none ring-line">
      <CardHeader><CardTitle className="text-base">Models this month</CardTitle><CardDescription>Usage by provider.</CardDescription></CardHeader>
      <CardContent>
        {data.byModel.length === 0
          ? <p className="text-sm text-ink-muted">No model has been used this month.</p>
          : <div className="space-y-3">{data.byModel.map((row) => <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-fill px-3 py-2.5 text-xs" key={row.model}>
              <div className="min-w-0"><p className="truncate font-semibold">{row.label}</p><p className="truncate text-[10px] text-ink-subtle">{row.model}</p></div>
              <div className="flex shrink-0 gap-4 text-right tabular-nums">
                <div><p className="text-[10px] text-ink-subtle">Input</p><p className="font-medium">{formatTokens(row.inputTokens)}</p></div>
                <div><p className="text-[10px] text-ink-subtle">Output</p><p className="font-medium">{formatTokens(row.outputTokens)}</p></div>
                <div><p className="text-[10px] text-ink-subtle">Requests</p><p className="font-medium">{row.requests}</p></div>
              </div>
            </div>)}</div>}
      </CardContent>
    </Card>
  </section>;
}
