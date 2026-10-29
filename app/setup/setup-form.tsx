'use client';

import { useState } from 'react';
import { ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SetupRequest, SetupResponse } from '@/lib/contracts/account';
import type { ApiReply } from '@/lib/contracts/common';

export function SetupForm() {
  const [token, setToken] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ready = token.trim().length >= 32 && (displayName.trim().length === 0 || displayName.trim().length >= 2);

  async function signIn() {
    if (!ready || saving) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), displayName: displayName.trim() || undefined } satisfies SetupRequest),
      });
      const payload = (await response.json()) as ApiReply<SetupResponse>;
      if (!response.ok) throw new Error(payload.error ?? 'Could not sign in as the owner.');
      window.location.replace('/');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not sign in as the owner.'); }
    finally { setSaving(false); }
  }

  return <main className="grid min-h-screen place-items-center bg-[#eef1ed] p-4 text-[#15211f]">
    <section className="w-full max-w-md rounded-3xl border border-black/7 bg-white p-6 shadow-[0_24px_80px_rgba(21,42,37,.12)] sm:p-8">
      <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-[#173d38] text-white"><KeyRound className="size-5" /></span>
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#4b766f]"><ShieldCheck className="size-4" /> Owner access</p>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in as the owner</h1>
      <p className="mt-2 text-sm leading-6 text-[#66726f]">Enter the setup key stored in the server&apos;s <code className="rounded bg-[#eef1ed] px-1 text-xs">OWNER_SETUP_TOKEN</code> secret. The first sign-in creates the owner account; later ones restore access to it.</p>
      <label className="mt-6 block text-sm font-medium" htmlFor="setup-token">Setup key</label>
      <Input autoComplete="off" className="mt-2 h-11" id="setup-token" onChange={(event) => setToken(event.target.value)} spellCheck={false} type="password" value={token} />
      <label className="mt-4 block text-sm font-medium" htmlFor="setup-name">Display name <span className="font-normal text-[#7d8784]">(first sign-in only)</span></label>
      <Input className="mt-2 h-11" id="setup-name" maxLength={100} onChange={(event) => setDisplayName(event.target.value)} placeholder="Name or nickname" value={displayName} />
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
      <Button className="mt-5 h-11 w-full bg-[#173d38] text-white hover:bg-[#23534c]" disabled={!ready || saving} onClick={() => void signIn()}>{saving ? 'Signing in…' : <>Continue <ArrowRight /></>}</Button>
      <p className="mt-4 text-center text-[11px] leading-5 text-[#7d8784]">The key never leaves this request and is not stored in the browser. Anyone who has it can act as the owner, so keep it in the server&apos;s secret store only.</p>
    </section>
  </main>;
}
