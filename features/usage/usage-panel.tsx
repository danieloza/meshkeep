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
  return <Card className="border-0 bg-white/90 shadow-[0_8px_30px_rgba(24,48,44,.045)] ring-black/6"><CardHeader><CardDescription className="flex items-center gap-2"><Bot className="size-4" /> API usage</CardDescription><CardTitle className="flex items-center gap-2 text-base">Your limits <Badge className="bg-[#dff4ed] text-[#286057]" variant="secondary">FREE</Badge></CardTitle></CardHeader><CardContent className="space-y-5"><div><div className="mb-2 flex items-end justify-between"><div><p className="text-xs text-[#75817e]">Daily limit</p><p className="mt-0.5 text-lg font-semibold">{formatTokens(total)} <span className="text-xs font-normal text-[#88928f]">/ {formatTokens(dailyLimit)}</span></p></div><span className="text-xs font-medium text-[#396b62]">{percent}%</span></div><Progress className="[&_[data-slot=progress-indicator]]:bg-[#2c766a] [&_[data-slot=progress-track]]:h-1.5" value={percent} /></div><div><div className="mb-2 flex items-end justify-between"><div><p className="text-xs text-[#75817e]">Monthly limit</p><p className="mt-0.5 text-sm font-semibold">{formatTokens(monthlyUsage)} <span className="text-xs font-normal text-[#88928f]">/ {formatTokens(monthlyLimit)}</span></p></div><span className="text-xs font-medium text-[#396b62]">{monthlyPercent}%</span></div><Progress className="[&_[data-slot=progress-indicator]]:bg-[#4d8b80] [&_[data-slot=progress-track]]:h-1" value={monthlyPercent} /></div><div className="grid grid-cols-2 gap-3 rounded-xl bg-[#f3f5f2] p-3 text-xs"><div><p className="text-[#7a8582]">Wire format</p><p className="mt-1 font-semibold">OpenAI-compatible</p></div><div><p className="text-[#7a8582]">Provider</p><p className="mt-1 truncate font-semibold" title={providerName}>{providerName}</p></div><div><p className="text-[#7a8582]">Input today</p><p className="mt-1 font-semibold">{formatTokens(inputUsage)}</p></div><div><p className="text-[#7a8582]">Output today</p><p className="mt-1 font-semibold">{formatTokens(outputUsage)}</p></div></div><p className="flex items-start gap-2 text-[11px] leading-4 text-[#7a8582]"><ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[#3c756b]" /> {keyNote}</p></CardContent></Card>;
}
