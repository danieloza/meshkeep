'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import type { ProviderState } from '@/lib/contracts/providers';
import { Hint } from '@/components/hint';
import { ORIGIN_LABEL } from '@/features/providers/effective-provider';

export function ProviderCard({ onNotice, onChanged }: { onNotice: (message: string) => void; onChanged: () => void }) {
  const [state, setState] = useState<ProviderState | null>(null);
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [forTeam, setForTeam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try { setState(await api.provider.get()); } catch { /* the card keeps what it showed */ }
  }
  // Ten sam wzorzec, co pozostale pobrania w tym pliku: flaga `active` chroni
  // przed zapisem stanu po odmontowaniu, a setState dzieje sie w wywolaniu
  // zwrotnym obietnicy, nie w ciele efektu.
  useEffect(() => {
    let active = true;
    api.provider.get().then((payload) => { if (active) setState(payload); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function save() {
    setBusy(true); setError(null);
    try {
      const payload = await api.provider.save({ label, baseUrl, apiKey, scope: forTeam ? 'team' : 'mine' });
      // The key is never echoed back, so there is nothing to keep in the form.
      setApiKey('');
      onNotice(`Provider connected. ${payload.modelCount} models available.`);
      await load();
      onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save the provider.'); }
    finally { setBusy(false); }
  }

  async function remove(scope: 'mine' | 'team') {
    if (!window.confirm(scope === 'team' ? 'Remove the provider for the whole team?' : 'Remove your own provider and fall back to the team default?')) return;
    setBusy(true);
    try {
      await api.provider.remove(scope);
      onNotice('Provider removed.');
      await load();
      onChanged();
    } catch (caught) { onNotice(caught instanceof Error ? caught.message : 'Could not remove the provider.'); }
    finally { setBusy(false); }
  }

  if (!state) return null;

  const field = 'h-9 w-full rounded-lg border border-line-strong bg-surface-raised px-2 text-xs outline-none focus:ring-2 focus:ring-[#4d8b80]/30';

  return <Card className="border-0 bg-surface-raised/90 shadow-none ring-line">
    <CardHeader>
      <CardTitle className="flex items-center gap-1.5 text-base">Model provider
        <Hint text="Any service that speaks the OpenAI format works: OpenAI, OpenRouter, Groq, Together, Mistral, or a model running on your own machine. Your key is stored on the server, never sent to the browser and never included in a backup." />
      </CardTitle>
      <CardDescription>
        {state.effective
          ? <>Messages currently go to <b>{state.effective.label}</b> using {ORIGIN_LABEL[state.effective.origin]}, with {state.effective.modelCount} models available.</>
          : 'No provider is connected, so the chat cannot reach a model.'}
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-3">
      {[['Yours', state.mine, 'mine'] as const, ['Team default', state.team, 'team'] as const].map(([title, summary, scope]) => summary && (
        <div className="flex items-center gap-2 rounded-lg bg-surface-fill px-3 py-2 text-[11px]" key={scope}>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{title}: {summary.label}</p>
            <p className="truncate text-ink-subtle">{summary.baseUrl} · key {summary.keyPreview} · {summary.modelCount} models</p>
          </div>
          {(scope === 'mine' || state.canSetTeam) && <Button aria-label={`Remove ${title}`} disabled={busy} onClick={() => void remove(scope)} size="icon-xs" variant="ghost"><Trash2 /></Button>}
        </div>
      ))}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] font-medium" htmlFor="provider-label">Name
          <input className={field} id="provider-label" maxLength={60} onChange={(event) => setLabel(event.target.value)} placeholder="OpenRouter" value={label} />
        </label>
        <label className="text-[11px] font-medium" htmlFor="provider-url">Base URL
          <input className={field} id="provider-url" maxLength={400} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://openrouter.ai/api/v1" value={baseUrl} />
        </label>
      </div>
      <label className="block text-[11px] font-medium" htmlFor="provider-key">API key
        {/* type=password so a shoulder or a screen share does not reveal it. */}
        <input autoComplete="off" className={field} id="provider-key" maxLength={400} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-…" type="password" value={apiKey} />
      </label>
      {state.canSetTeam && <label className="flex items-center gap-2 text-[11px]">
        <input checked={forTeam} onChange={(event) => setForTeam(event.target.checked)} type="checkbox" />
        Use for the whole team instead of only me
      </label>}
      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[11px] text-danger-text">{error}</p>}
      <Button className="bg-brand text-white hover:bg-brand-hover" disabled={busy || !label.trim() || !baseUrl.trim() || apiKey.trim().length < 8} onClick={() => void save()} size="sm">
        {busy ? 'Checking…' : 'Connect provider'}
      </Button>
      <p className="text-[10px] leading-4 text-ink-subtle">The key is verified against the provider before it is stored, so a wrong one is reported here rather than at your first message.</p>
    </CardContent>
  </Card>;
}
