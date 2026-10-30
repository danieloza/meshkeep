'use client';

import { useState } from 'react';
import { ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';

export function JoinForm({ token }: { token: string }) {
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function join() {
    if (!token || displayName.trim().length < 2 || saving) return;
    setSaving(true); setError(null);
    try {
      await api.auth.join({ token, displayName: displayName.trim() });
      window.location.replace('/');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not join the team.'); }
    finally { setSaving(false); }
  }

  return <main className="grid min-h-screen place-items-center bg-surface p-4 text-ink">
    <section className="w-full max-w-md rounded-3xl border border-line bg-surface-raised p-6 shadow-[0_24px_80px_rgba(21,42,37,.12)] sm:p-8">
      <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-brand text-white"><LockKeyhole className="size-5" /></span>
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-brand-text-soft"><ShieldCheck className="size-4" /> Private team</p>
      <h1 className="text-2xl font-semibold tracking-tight">Join MeshKeep</h1>
      <p className="mt-2 text-sm leading-6 text-ink-muted">This one-time link is assigned to the address invited by the workspace owner.</p>
      <label className="mt-6 block text-sm font-medium" htmlFor="join-name">How should we display your name?</label>
      <Input className="mt-2 h-11" id="join-name" maxLength={100} onChange={(event) => setDisplayName(event.target.value)} placeholder="Name or nickname" value={displayName} />
      {error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger-text">{error}</p>}
      <Button className="mt-5 h-11 w-full bg-brand text-white hover:bg-brand-hover" disabled={!token || displayName.trim().length < 2 || saving} onClick={() => void join()}>{saving ? 'Joining…' : <>Join without a ChatGPT account <ArrowRight /></>}</Button>
      <p className="mt-4 text-center text-[11px] leading-5 text-ink-subtle">After joining, your browser receives a secure session that scripts cannot read. It renews while you use the app and expires after seven days of inactivity. The owner can issue a reconnect link if needed.</p>
    </section>
  </main>;
}
