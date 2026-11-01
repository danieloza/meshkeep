'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import type { UpdateMemberRequest } from '@/lib/contracts/team';
import { DEFAULT_DAILY_TOKENS, DEFAULT_MONTHLY_TOKENS, limitsAreCoherent, parseLimitInput } from '@/lib/limits';

// The owner's editor for one member's token limits and model access, shown
// under that member's usage. The server checks the same rules again.
export function MemberLimits({ memberId, displayName, dailyTokens, monthlyTokens, apiEnabled, onSaved, onNotice }: { memberId: string; displayName: string; dailyTokens: number | null; monthlyTokens: number | null; apiEnabled: boolean | null; onSaved: () => void; onNotice: (message: string) => void }) {
  const [daily, setDaily] = useState(String(dailyTokens ?? DEFAULT_DAILY_TOKENS));
  const [monthly, setMonthly] = useState(String(monthlyTokens ?? DEFAULT_MONTHLY_TOKENS));
  const [busy, setBusy] = useState(false);

  async function patch(body: UpdateMemberRequest, message: string) {
    setBusy(true);
    try {
      await api.team.updateMember(memberId, body);
      onSaved();
      onNotice(message);
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not save the change.'); }
    finally { setBusy(false); }
  }

  function saveLimits() {
    const nextDaily = parseLimitInput(daily, 'dailyTokens');
    const nextMonthly = parseLimitInput(monthly, 'monthlyTokens');
    if (nextDaily === null || nextMonthly === null) { onNotice('Limits must be whole numbers within the allowed range.'); return; }
    if (!limitsAreCoherent(nextDaily, nextMonthly)) { onNotice('The monthly limit cannot be lower than the daily limit.'); return; }
    void patch({ dailyTokens: nextDaily, monthlyTokens: nextMonthly }, `Limits saved for ${displayName}.`);
  }

  return <div className="mt-2 space-y-2 border-t border-line pt-2">
    <div className="flex gap-2">
      <div className="flex-1"><label className="text-xs text-ink-subtle" htmlFor={`limit-daily-${memberId}`}>Daily tokens</label>
        <Input className="mt-1 h-9 bg-surface-raised text-sm dark:bg-surface-raised" id={`limit-daily-${memberId}`} inputMode="numeric" onChange={(event) => setDaily(event.target.value)} value={daily} /></div>
      <div className="flex-1"><label className="text-xs text-ink-subtle" htmlFor={`limit-monthly-${memberId}`}>Monthly tokens</label>
        <Input className="mt-1 h-9 bg-surface-raised text-sm dark:bg-surface-raised" id={`limit-monthly-${memberId}`} inputMode="numeric" onChange={(event) => setMonthly(event.target.value)} value={monthly} /></div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="flex min-h-11 items-center gap-2 text-xs text-ink-muted">
        <input checked={apiEnabled !== false} className="size-4 accent-brand" disabled={busy} onChange={(event) => void patch({ apiEnabled: event.target.checked }, event.target.checked ? `Model access enabled for ${displayName}.` : `Model access disabled for ${displayName}.`)} type="checkbox" />
        Model access
      </label>
      <Button disabled={busy} onClick={saveLimits} size="sm" variant="outline">{busy ? 'Saving…' : 'Save limits'}</Button>
    </div>
  </div>;
}
