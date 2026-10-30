import { Bot, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ORIGIN_LABEL, useEffectiveProvider } from '@/features/providers/effective-provider';
import { formatTokens } from '@/lib/format';

export function UsagePanel({ dailyLimit, inputUsage, monthlyLimit, monthlyUsage, outputUsage }: { dailyLimit: number; inputUsage: number; monthlyLimit: number; monthlyUsage: number; outputUsage: number }) {
  const total = inputUsage + outputUsage;
  const percent = dailyLimit ? Math.min(100, Math.round((total / dailyLimit) * 100)) : 0;
  const monthlyPercent = monthlyLimit ? Math.min(100, Math.round((monthlyUsage / monthlyLimit) * 100)) : 0;
  const { effective, loaded } = useEffectiveProvider();
  // Do not guess a provider name while the server response is still pending.
  const providerName = effective ? effective.label : loaded ? 'Not connected' : '—';
  const keyNote = effective
    ? `Messages go out on ${ORIGIN_LABEL[effective.origin]}, which stays on the server and never reaches the browser.`
    : loaded
      ? 'No provider is connected, so the chat cannot reach a model.'
      : 'Checking which provider answers your messages.';
  return <Card className="border-0 bg-surface-raised/90 shadow-[0_8px_30px_rgba(24,48,44,.045)] ring-line"><CardHeader><CardDescription className="flex items-center gap-2"><Bot className="size-4" /> API usage</CardDescription><CardTitle className="flex items-center gap-2 text-base">Your limits <Badge className="bg-surface-selected text-brand-text" variant="secondary">FREE</Badge></CardTitle></CardHeader><CardContent className="space-y-5"><div><div className="mb-2 flex items-end justify-between"><div><p className="text-xs text-ink-muted">Daily limit</p><p className="mt-0.5 text-lg font-semibold">{formatTokens(total)} <span className="text-xs font-normal text-ink-subtle">/ {formatTokens(dailyLimit)}</span></p></div><span className="text-xs font-medium text-brand-text">{percent}%</span></div><Progress className="[&_[data-slot=progress-indicator]]:bg-[#2c766a] [&_[data-slot=progress-track]]:h-1.5" value={percent} /></div><div><div className="mb-2 flex items-end justify-between"><div><p className="text-xs text-ink-muted">Monthly limit</p><p className="mt-0.5 text-sm font-semibold">{formatTokens(monthlyUsage)} <span className="text-xs font-normal text-ink-subtle">/ {formatTokens(monthlyLimit)}</span></p></div><span className="text-xs font-medium text-brand-text">{monthlyPercent}%</span></div><Progress className="[&_[data-slot=progress-indicator]]:bg-[#4d8b80] [&_[data-slot=progress-track]]:h-1" value={monthlyPercent} /></div><div className="grid grid-cols-2 gap-3 rounded-xl bg-surface-fill p-3 text-xs"><div><p className="text-ink-subtle">Wire format</p><p className="mt-1 font-semibold">OpenAI-compatible</p></div><div><p className="text-ink-subtle">Provider</p><p className="mt-1 truncate font-semibold" title={providerName}>{providerName}</p></div><div><p className="text-ink-subtle">Input today</p><p className="mt-1 font-semibold">{formatTokens(inputUsage)}</p></div><div><p className="text-ink-subtle">Output today</p><p className="mt-1 font-semibold">{formatTokens(outputUsage)}</p></div></div><p className="flex items-start gap-2 text-[11px] leading-4 text-ink-subtle"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-brand-text" /> {keyNote}</p></CardContent></Card>;
}
