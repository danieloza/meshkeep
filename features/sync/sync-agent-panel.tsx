'use client';

import { useEffect, useState } from 'react';
import { Download, KeyRound, Copy, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import type { CreateSyncTokenResponse } from '@/lib/contracts/sync';
import { Hint } from '@/components/hint';

// A new key comes back without `lastUsedAt` and `createdAt`, and the list
// shows neither, so it holds only what both responses have.
type SyncCredentialSummary = CreateSyncTokenResponse['credential'];

export function SyncAgentPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [tokens, setTokens] = useState<SyncCredentialSummary[]>([]);
  const [rawToken, setRawToken] = useState('');
  const [creating, setCreating] = useState(false);
  useEffect(() => { api.sync.tokens().then((payload) => setTokens(payload.tokens)).catch(() => undefined); }, []);
  async function createToken() {
    setCreating(true); setRawToken('');
    try {
      const payload = await api.sync.createToken({ label: `Windows · ${new Date().toLocaleDateString('en-US')}` });
      setRawToken(payload.token); setTokens((current) => [payload.credential, ...current]);
      onNotice('Agent key created. It is shown only once.');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not create an agent key.'); }
    finally { setCreating(false); }
  }
  async function revoke(id: string) {
    try {
      await api.sync.revokeToken({ id });
      setTokens((current) => current.filter((token) => token.id !== id)); setRawToken(''); onNotice('Agent key revoked.');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not revoke the agent key.'); }
  }
  return <Card className="border-0 bg-surface-raised/90 shadow-none ring-line"><CardHeader><CardTitle className="flex items-center gap-1.5 text-base">Local folder<Hint text="An agent key lets one machine upload and delete files in projects you can edit. It grants no model access and is shown once, because the server keeps only its hash. Revoking it stops that machine immediately." /></CardTitle><CardDescription>The agent copies changed files only to the selected project.</CardDescription></CardHeader><CardContent className="space-y-3"><a className="inline-flex h-8 items-center gap-2 rounded-lg border border-line-strong bg-surface-raised px-3 text-xs font-medium hover:bg-black/[0.03]" download href="/meshkeep-sync.ps1"><Download className="size-3.5" /> Download Windows agent</a><Button disabled={creating} onClick={() => void createToken()} size="sm" variant="outline"><KeyRound /> {creating ? 'Creating…' : 'New agent key'}</Button>{rawToken && <div className="rounded-xl border border-amber-700/10 bg-warn-soft p-3"><p className="mb-2 text-[11px] leading-4 text-warn-text">Copy it now. The key will not be shown again and grants no model access.</p><div className="flex gap-2"><Input aria-label="Sync agent key" className="h-8 min-w-0 bg-surface-raised text-[10px] dark:bg-surface-raised" readOnly value={rawToken} /><Button onClick={() => { void navigator.clipboard.writeText(rawToken); onNotice('Agent key copied.'); }} size="icon-sm" type="button" variant="outline"><Copy /></Button></div></div>}{tokens.map((token) => <div className="flex items-center gap-2 rounded-lg bg-surface-fill px-3 py-2 text-[11px]" key={token.id}><div className="min-w-0 flex-1"><p className="truncate font-medium">{token.label}</p><p className="text-ink-subtle">expires {new Date(token.expiresAt).toLocaleDateString('en-US')}</p></div><Button aria-label={`Revoke ${token.label}`} onClick={() => void revoke(token.id)} size="icon-xs" variant="ghost"><Trash2 /></Button></div>)}</CardContent></Card>;
}
