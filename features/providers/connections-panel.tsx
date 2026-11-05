'use client';

import { useEffect, useState } from 'react';
import { plug } from '@lucasmarkes/hairline';
import { Check, CircleCheck, KeyRound, Plus, RefreshCw, Trash2, TriangleAlert, X } from 'lucide-react';
import { Hint } from '@/components/hint';
import { LineFigure } from '@/components/line-figure';
import { Button } from '@/components/ui/button';
import { ORIGIN_LABEL } from '@/features/providers/effective-provider';
import { api } from '@/lib/api-client';
import type { ConnectionScope, ProviderConnection, ProviderConnections } from '@/lib/contracts/providers';
import { isProviderPresetId, PROVIDER_PRESET_IDS, PROVIDER_PRESETS, type ProviderPresetId, recognizeKey } from '@/lib/provider-presets';
import { cn } from '@/lib/utils';
import { chatModelCount, statusLine, statusTone, summarize, type Tone } from './connections';

type ProviderChoice = ProviderPresetId | 'other' | '';

const field = 'h-9 w-full rounded-lg border border-line-strong bg-surface-raised px-2 text-xs outline-none focus:ring-2 focus:ring-ring/30';
const SCOPE_LABEL: Record<ConnectionScope, string> = { mine: 'Only me', team: 'Team' };
const TONE_DOT: Record<Tone, string> = { ok: 'bg-ok-text', danger: 'bg-danger-text', warn: 'bg-warn-text', muted: 'bg-line-strong' };
const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok-text', danger: 'text-danger-text', warn: 'text-warn-text', muted: 'text-ink-subtle' };

const message = (caught: unknown, fallback: string) => (caught instanceof Error ? caught.message : fallback);

// Seven days of the viewer's own tokens through one connection, today last.
function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const total = values.reduce((sum, value) => sum + value, 0);
  return <span className="shrink-0" title={`Your tokens in the last 7 days: ${total.toLocaleString('en')}`}>
    <svg aria-hidden className="h-5 w-14 text-brand" viewBox="0 0 56 20">
      {values.map((value, day) => {
        const height = value ? Math.max(2, (value / max) * 18) : 1;
        return <rect fill="currentColor" height={height} key={day} opacity={value ? 0.85 : 0.25} rx={1} width={6} x={day * 8} y={20 - height} />;
      })}
    </svg>
    <span className="sr-only">Your tokens in the last 7 days: {total.toLocaleString('en')}</span>
  </span>;
}

// Which models the chat offers from a connection, and which accept Effort.
// A long list starts with none offered, so it opens with a search box.
function ModelChoice({ connection, onSaved, onNotice }: { connection: ProviderConnection; onSaved: (next: ProviderConnection) => void; onNotice: (text: string) => void }) {
  const [all, setAll] = useState(connection.chatModels === null);
  const [chat, setChat] = useState<string[]>(connection.chatModels ?? connection.models.map((model) => model.id));
  const [effort, setEffort] = useState(connection.effortModels);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const needle = filter.trim().toLocaleLowerCase('en');
  const shown = needle ? connection.models.filter((model) => `${model.id} ${model.label}`.toLocaleLowerCase('en').includes(needle)) : connection.models;
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((item) => item !== id));

  async function save() {
    setSaving(true);
    try {
      const { connection: next } = await api.providers.update(connection.id, { chatModels: all ? null : chat, effortModels: effort });
      onNotice(`${next.label}: ${chatModelCount(next)} ${chatModelCount(next) === 1 ? 'model' : 'models'} in the chat.`);
      onSaved(next);
    } catch (caught) { onNotice(message(caught, 'Could not save the models.')); }
    finally { setSaving(false); }
  }

  return <div className="space-y-2 border-t border-line px-3 py-3 text-[11px]">
    <label className="flex items-center gap-2">
      <input checked={all} onChange={(event) => setAll(event.target.checked)} type="checkbox" />
      Offer every model in the chat
    </label>
    {connection.models.length > 8 && <input aria-label={`Search the models of ${connection.label}`} className={field} onChange={(event) => setFilter(event.target.value)} placeholder={`Search ${connection.models.length} models`} value={filter} />}
    <div className="max-h-64 overflow-y-auto">
      <table className="w-full">
        <thead className="sticky top-0 bg-surface-raised text-left text-ink-subtle"><tr><th className="py-1 font-medium">Model</th><th className="w-14 py-1 text-center font-medium">Chat</th><th className="w-14 py-1 text-center font-medium">Effort</th></tr></thead>
        <tbody>
          {shown.map((model) => <tr className="border-t border-line first:border-t-0" key={model.id}>
            <td className="max-w-0 py-1 pr-2"><span className="block truncate" title={model.id}>{model.label}</span></td>
            <td className="w-14 text-center"><input aria-label={`Offer ${model.label} in the chat`} checked={all || chat.includes(model.id)} disabled={all} onChange={(event) => setChat((current) => toggle(current, model.id, event.target.checked))} type="checkbox" /></td>
            <td className="w-14 text-center"><input aria-label={`${model.label} accepts Effort`} checked={effort.includes(model.id)} onChange={(event) => setEffort((current) => toggle(current, model.id, event.target.checked))} type="checkbox" /></td>
          </tr>)}
          {!shown.length && <tr><td className="py-2 text-ink-subtle" colSpan={3}>No model matches.</td></tr>}
        </tbody>
      </table>
    </div>
    <p className="leading-4 text-ink-subtle">Effort sends <code>reasoning_effort</code>, so mark only models that accept it.</p>
    <Button disabled={saving} onClick={() => void save()} size="sm" variant="outline">{saving ? 'Saving…' : `Save · ${all ? connection.models.length : chat.length} in the chat`}</Button>
  </div>;
}

function ConnectionRow({ connection, onChanged, onRemoved, onNotice }: { connection: ProviderConnection; onChanged: (next: ProviderConnection) => void; onRemoved: (id: string) => void; onNotice: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const tone = statusTone(connection.status);
  const inChat = chatModelCount(connection);
  const unchosen = connection.models.length > 0 && inChat === 0;

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await action(); } catch (caught) { setError(message(caught, 'Something went wrong.')); }
    finally { setBusy(false); }
  }

  const check = () => run(async () => {
    const { connection: next } = await api.providers.check(connection.id);
    onChanged(next);
    onNotice(next.status === 'ok' ? `${next.label} works. ${next.models.length} models available.` : `${next.label}: ${statusLine(next)}.`);
  });
  const replace = () => run(async () => {
    const { connection: next } = await api.providers.replaceKey(connection.id, { apiKey: newKey });
    // The key is never echoed back, so there is nothing to keep in the form.
    setNewKey(''); setReplacing(false);
    onChanged(next);
    onNotice(`New key for ${next.label} checked and saved.`);
  });
  const remove = () => {
    if (!window.confirm(connection.scope === 'team' ? `Remove ${connection.label} for the whole team?` : `Remove ${connection.label}?`)) return;
    void run(async () => { await api.providers.remove(connection.id); onRemoved(connection.id); onNotice(`${connection.label} removed.`); });
  };

  return <li className={cn('overflow-hidden rounded-xl border bg-surface-raised', tone === 'danger' ? 'border-danger-text/40' : 'border-line')}>
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', TONE_DOT[tone])} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <span className="truncate">{connection.label}</span>
          <span className={cn('shrink-0 rounded-md px-1.5 py-px text-[10px] font-medium', connection.scope === 'team' ? 'bg-team-soft text-team-text' : 'bg-private-soft text-private-text')}>{SCOPE_LABEL[connection.scope]}</span>
        </p>
        <p className="truncate text-[11px] text-ink-subtle">
          <span className="font-mono">{connection.keyPreview}</span>
          {' · '}{connection.models.length ? `${inChat} of ${connection.models.length} ${connection.models.length === 1 ? 'model' : 'models'} in the chat` : 'models named by hand'}
          {' · '}<span className={TONE_TEXT[tone]}>{statusLine(connection)}</span>
        </p>
      </div>
      <Sparkline values={connection.usage7d} />
      {connection.canManage && <div className="flex shrink-0 items-center gap-0.5">
        <Button aria-label={`Check ${connection.label}`} disabled={busy} onClick={() => void check()} size="icon-xs" title="Check the key" variant="ghost"><RefreshCw className={cn(busy && 'animate-spin')} /></Button>
        <Button aria-expanded={replacing} aria-label={`Replace the key of ${connection.label}`} disabled={busy} onClick={() => { setReplacing((open) => !open); setError(null); }} size="icon-xs" title="Replace the key" variant="ghost"><KeyRound /></Button>
        <Button aria-label={`Remove ${connection.label}`} disabled={busy} onClick={remove} size="icon-xs" title="Remove" variant="ghost"><Trash2 /></Button>
      </div>}
    </div>

    {tone === 'danger' && connection.canManage && !replacing && <p className="flex items-center gap-1.5 bg-danger-soft px-3 py-1.5 text-[11px] text-danger-text"><TriangleAlert aria-hidden className="size-3.5 shrink-0" />The provider refused this key. Replace it to keep using {connection.label}.</p>}
    {unchosen && connection.canManage && <p className="bg-warn-soft px-3 py-1.5 text-[11px] text-warn-text">{connection.label} offers {connection.models.length} models. Choose which ones the chat shows.</p>}

    {replacing && <div className="space-y-2 border-t border-line px-3 py-3">
      <label className="block text-[11px] font-medium" htmlFor={`replace-${connection.id}`}>New key for {connection.label}
        <input autoComplete="off" className={cn(field, 'mt-1 font-mono')} id={`replace-${connection.id}`} maxLength={400} onChange={(event) => setNewKey(event.target.value)} placeholder="Paste the new key" spellCheck={false} type="password" value={newKey} />
      </label>
      <p className="text-[10px] leading-4 text-ink-subtle">The new key is checked first. If the check fails, the current key stays in use.</p>
      <div className="flex gap-2">
        <Button className="bg-brand text-brand-ink hover:bg-brand-hover" disabled={busy || newKey.trim().length < 8} onClick={() => void replace()} size="sm">{busy ? 'Checking…' : 'Check and replace'}</Button>
        <Button disabled={busy} onClick={() => { setReplacing(false); setNewKey(''); setError(null); }} size="sm" variant="ghost">Cancel</Button>
      </div>
    </div>}

    {error && <p className="border-t border-line bg-danger-soft px-3 py-2 text-[11px] text-danger-text" role="alert">{error}</p>}

    {connection.canManage && connection.models.length > 0 && <details className="border-t border-line" open={unchosen}>
      <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium text-ink-muted hover:text-ink">Models · {inChat} in the chat · {connection.effortModels.length} with Effort</summary>
      {/* The key resets the choice to what was saved after each save. */}
      <ModelChoice connection={connection} key={`${connection.chatModels?.join('|') ?? 'all'}/${connection.effortModels.join('|')}`} onNotice={onNotice} onSaved={onChanged} />
    </details>}
  </li>;
}

const STEPS = ['Recognized', 'Key checked', 'Encrypted', 'Saved'] as const;

function AddConnection({ canSetTeam, onAdded, onCancel, onNotice }: { canSetTeam: boolean; onAdded: (connection: ProviderConnection) => void; onCancel?: () => void; onNotice: (text: string) => void }) {
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<ProviderChoice>('');
  // A provider picked from the list stays picked; until then a recognized key
  // picks it.
  const [pickedByHand, setPickedByHand] = useState(false);
  const [scope, setScope] = useState<ConnectionScope>('mine');
  // How far the save got: 0 nothing yet, 1 sent for checking, 4 saved.
  const [step, setStep] = useState(0);
  const [modelCount, setModelCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A preset fills in the name and the address, which stay editable. "Other"
  // keeps whatever is typed there.
  function choose(choice: ProviderChoice, byHand: boolean) {
    // Fields still holding the previous preset's values were filled in, not
    // typed, so they go with it.
    const previous = isProviderPresetId(provider) ? PROVIDER_PRESETS[provider] : null;
    setProvider(choice);
    setPickedByHand(byHand);
    if (isProviderPresetId(choice)) {
      setLabel(PROVIDER_PRESETS[choice].label);
      setBaseUrl(PROVIDER_PRESETS[choice].baseUrl);
      return;
    }
    if (previous && label === previous.label) setLabel('');
    if (previous && baseUrl === previous.baseUrl) setBaseUrl('');
  }

  function changeKey(value: string) {
    setApiKey(value); setStep(0); setError(null);
    if (pickedByHand) return;
    const recognized = recognizeKey(value);
    if (recognized.kind === 'recognized') {
      if (recognized.preset.id !== provider) choose(recognized.preset.id, false);
    } else if (provider !== '') {
      // A provider this form picked for an earlier key must not carry over to
      // a key it cannot place: that key would go to the wrong company.
      choose('', false);
    }
  }

  async function save() {
    setStep(1); setError(null);
    try {
      // Checking, encrypting and saving happen on the server in one request,
      // so the last three steps complete together.
      const { connection } = await api.providers.add({ label, baseUrl, apiKey, scope });
      setModelCount(connection.models.length);
      setStep(4);
      setApiKey('');
      onNotice(`${connection.label} connected. ${connection.models.length} models available.`);
      onAdded(connection);
    } catch (caught) { setStep(0); setError(message(caught, 'Could not save the connection.')); }
  }

  const recognized = recognizeKey(apiKey);
  const preset = isProviderPresetId(provider) ? PROVIDER_PRESETS[provider] : null;
  // A key that plainly belongs to one vendor but is about to go to another.
  const mismatch = recognized.kind === 'recognized' && provider !== '' && recognized.preset.id !== provider ? recognized.preset : null;
  const busy = step === 1;
  const reached = (index: number) => (index === 0 ? provider !== '' && apiKey.trim().length >= 8 : step === 4);

  return <div className="space-y-3 rounded-xl border border-line bg-surface-raised p-3">
    <label className="block text-[11px] font-medium" htmlFor="connection-key">API key
      {/* type=password so a shoulder or a screen share does not reveal it. */}
      <input aria-describedby="connection-key-status" autoComplete="off" className={cn(field, 'mt-1 font-mono')} id="connection-key" maxLength={400} onChange={(event) => changeKey(event.target.value)} placeholder="Paste the key from your provider" spellCheck={false} type="password" value={apiKey} />
    </label>
    {/* Read out as the key is pasted; it never repeats the key itself. */}
    <div aria-live="polite" className="text-[11px] leading-4" id="connection-key-status">
      {recognized.kind === 'recognized' && !mismatch && <p className="flex items-center gap-1.5 text-ok-text"><CircleCheck aria-hidden className="size-3.5 shrink-0" />{recognized.preset.label}, recognized by {recognized.by}.</p>}
      {mismatch && <p className="flex items-start gap-1.5 text-warn-text"><TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />This looks like a {mismatch.label} key, but {preset?.label ?? 'another provider'} is chosen, so it would be sent there.</p>}
      {recognized.kind === 'ambiguous' && !isProviderPresetId(provider) && provider !== 'other' && <div className="space-y-1.5">
        <p className="text-ink-muted">Several providers issue keys that start with sk-. Which one is this?</p>
        <div className="flex flex-wrap gap-1.5">{recognized.presets.map((candidate) => <button className="min-h-8 rounded-lg border border-line-strong px-2.5 font-medium transition hover:bg-surface-fill" key={candidate.id} onClick={() => choose(candidate.id, true)} type="button">{candidate.label}</button>)}</div>
      </div>}
      {recognized.kind === 'unknown' && provider === '' && <p className="text-ink-muted">No provider recognized from this key. Choose one below, or Other for any OpenAI-compatible service.</p>}
    </div>

    <label className="block text-[11px] font-medium" htmlFor="connection-provider">Provider
      <select className={cn(field, 'mt-1')} id="connection-provider" onChange={(event) => choose(event.target.value as ProviderChoice, true)} value={provider}>
        <option disabled value="">Choose a provider</option>
        {PROVIDER_PRESET_IDS.map((id) => <option key={id} value={id}>{PROVIDER_PRESETS[id].label}</option>)}
        <option value="other">Other (OpenAI-compatible)</option>
      </select>
    </label>
    {preset?.note && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[11px] leading-4 text-warn-text">{preset.note}</p>}
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-[11px] font-medium" htmlFor="connection-label">Name
        <input className={cn(field, 'mt-1')} id="connection-label" maxLength={60} onChange={(event) => setLabel(event.target.value)} placeholder="OpenRouter" value={label} />
      </label>
      <label className="text-[11px] font-medium" htmlFor="connection-url">Base URL
        <input className={cn(field, 'mt-1')} id="connection-url" maxLength={400} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://openrouter.ai/api/v1" value={baseUrl} />
      </label>
    </div>
    {canSetTeam && <fieldset className="grid grid-cols-2 gap-1 rounded-xl bg-surface-fill p-1">
      <legend className="sr-only">Who uses this connection</legend>
      {(['mine', 'team'] as const).map((option) => <button aria-pressed={scope === option} className={cn('min-h-8 whitespace-nowrap rounded-lg px-2 text-xs font-medium transition', scope === option ? 'bg-surface-raised text-ink shadow-sm' : 'text-ink-muted hover:text-ink')} key={option} onClick={() => setScope(option)} type="button">{option === 'mine' ? 'Only me' : 'The whole team'}</button>)}
    </fieldset>}

    <ol aria-label="Saving the key" className="grid grid-cols-4 gap-1 text-[10px]">
      {STEPS.map((name, index) => <li className={cn('flex items-center gap-1 rounded-md px-1.5 py-1', reached(index) ? 'bg-ok-soft text-ok-text' : index === 1 && busy ? 'bg-surface-fill text-ink' : 'bg-surface-fill text-ink-subtle')} key={name}>
        {reached(index) ? <Check aria-hidden className="size-3 shrink-0" /> : index === 1 && busy ? <RefreshCw aria-hidden className="size-3 shrink-0 animate-spin" /> : <span aria-hidden className="size-3 shrink-0" />}
        <span className="truncate">{index === 1 && step === 4 && modelCount !== null ? `${modelCount} models` : name}</span>
        <span className="sr-only">{reached(index) ? ': done' : ''}</span>
      </li>)}
    </ol>

    {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[11px] text-danger-text" role="alert">{error}</p>}
    <div className="flex gap-2">
      <Button className="bg-brand text-brand-ink hover:bg-brand-hover" disabled={busy || !label.trim() || !baseUrl.trim() || apiKey.trim().length < 8} onClick={() => void save()} size="sm">
        {busy ? 'Checking…' : 'Check and save'}
      </Button>
      {onCancel && <Button disabled={busy} onClick={onCancel} size="sm" variant="ghost"><X />Close</Button>}
    </div>
    <p className="text-[10px] leading-4 text-ink-subtle">The key is checked against the provider before it is stored, encrypted on the server and never sent back to the browser, so it cannot be shown again.</p>
  </div>;
}

export function ConnectionsPanel({ onNotice, onChanged }: { onNotice: (text: string) => void; onChanged: () => void }) {
  const [data, setData] = useState<ProviderConnections | null>(null);
  const [adding, setAdding] = useState(false);

  async function reload() {
    try { setData(await api.providers.list()); } catch { /* the panel keeps what it showed */ }
  }
  // The `active` flag keeps a late answer from landing after unmount; state is
  // set in the promise callback, not in the body of the effect.
  useEffect(() => {
    let active = true;
    api.providers.list().then((payload) => { if (active) setData(payload); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  if (!data) return null;

  const replaceOne = (next: ProviderConnection) => {
    setData((current) => current && { ...current, connections: current.connections.map((item) => (item.id === next.id ? next : item)) });
    onChanged();
  };
  const removeOne = (id: string) => {
    setData((current) => current && { ...current, connections: current.connections.filter((item) => item.id !== id) });
    void reload();
    onChanged();
  };
  const added = () => { setAdding(false); void reload(); onChanged(); };

  const counts = summarize(data.connections);
  const empty = data.connections.length === 0;

  // The settings page already titles the section, so the panel opens with
  // what matters: where messages go when the chat names no connection.
  return <section aria-label="Model connections" className="space-y-4">
    <p className="flex items-center gap-1.5 text-xs text-ink-muted">
      <span>
        {data.effective
          ? <>Without a choice in the chat, messages go to <b>{data.effective.label}</b> using {ORIGIN_LABEL[data.effective.origin]}.</>
          : 'No connection yet, so the chat cannot reach a model.'}
      </span>
      <Hint text="Paste a key and the form recognizes OpenAI, Anthropic, Google Gemini, OpenRouter, Groq and xAI by its prefix. DeepSeek, Kimi and Mistral are in the list, and Other takes any service that speaks the OpenAI format. Your own connections are yours alone; the owner can add connections for the whole team. Keys are stored encrypted on the server, never sent to the browser and never included in a backup." />
    </p>

    {!empty && <dl className="grid grid-cols-3 gap-2">
      {[['Connections', counts.total, 'text-ink'], ['Working', counts.working, 'text-ok-text'], ['Need attention', counts.attention, counts.attention ? 'text-danger-text' : 'text-ink-subtle']].map(([name, value, tone]) => <div className="rounded-xl bg-surface-fill px-3 py-2" key={name}>
        <dt className="text-[11px] text-ink-muted">{name}</dt>
        <dd className={cn('text-lg font-semibold tabular-nums', tone)}>{value}</dd>
      </div>)}
    </dl>}

    {empty && <div className="flex flex-col items-center gap-1 py-2 text-center">
      <LineFigure className="w-44" figure={plug} />
      <p className="text-sm font-medium">Plug in a model</p>
      <p className="max-w-sm text-xs text-ink-muted">Paste a key from any provider. MeshKeep recognizes it, checks it and keeps it encrypted on the server.</p>
    </div>}

    {(empty || adding) && <AddConnection canSetTeam={data.canSetTeam} onAdded={added} onCancel={empty ? undefined : () => setAdding(false)} onNotice={onNotice} />}

    {!empty && <>
      {!adding && <Button onClick={() => setAdding(true)} size="sm" variant="outline"><Plus />Add a connection</Button>}
      <ul aria-label="Connections" className="space-y-2">
        {data.connections.map((connection) => <ConnectionRow connection={connection} key={connection.id} onChanged={replaceOne} onNotice={onNotice} onRemoved={removeOne} />)}
      </ul>
      <p className="text-[10px] leading-4 text-ink-subtle">Up to {data.limit} connections of your own{data.canSetTeam ? `, and ${data.limit} for the team` : ''}. The chart shows your own tokens through each connection over the last 7 days.</p>
    </>}
  </section>;
}
