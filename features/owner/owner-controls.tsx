'use client';

import { useEffect, useState } from 'react';
import { Download, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api-client';
import type { StorageCheck } from '@/lib/contracts/admin';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/hint';

export function KillSwitchCard({ onNotice }: { onNotice: (message: string) => void }) {
  const [blocked, setBlocked] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    api.admin.settings().then((payload) => { if (active) setBlocked(payload.apiKillSwitch); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function toggle(next: boolean) {
    const previous = blocked;
    setBlocked(next);
    try {
      await api.admin.updateSettings({ apiKillSwitch: next });
      onNotice(next ? 'Models disabled for the entire team.' : 'Model access restored.');
    } catch { setBlocked(previous); onNotice('Could not update the setting.'); }
  }

  if (blocked === null) return null;

  return <Card className={cn('border-0 shadow-none ring-black/6', blocked ? 'bg-red-50' : 'bg-white/90')}>
    <CardHeader>
      <CardDescription className="flex items-center gap-2"><ShieldCheck className="size-4" /> Owner controls</CardDescription>
      <CardTitle className="flex items-center gap-1.5 text-base">Emergency model cutoff<Hint text="Blocks model requests for everyone, including you. Nothing is deleted: projects, files, conversations and the log stay untouched, and the rest of the app keeps working." /></CardTitle>
      <CardAction><Switch aria-label="Emergency model access cutoff" checked={blocked} onCheckedChange={(value) => void toggle(value)} /></CardAction>
    </CardHeader>
    <CardContent>
      <p className="text-sm leading-6 text-[#63706d]">{blocked
        ? 'Model requests are blocked for the entire team, including you. Projects, files and history remain available.'
        : 'Models are available. This switch blocks every model request immediately without changing stored data.'}</p>
    </CardContent>
  </Card>;
}

export function BackupCard({ onNotice }: { onNotice: (message: string) => void }) {
  const [check, setCheck] = useState<StorageCheck | null>(null);
  const [busy, setBusy] = useState(false);

  async function verifyStorage() {
    setBusy(true);
    try {
      setCheck(await api.admin.checkStorage());
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not verify file storage.'); }
    finally { setBusy(false); }
  }

  return <Card className="border-0 bg-white/90 shadow-none ring-black/6">
    <CardHeader>
      <CardDescription className="flex items-center gap-2"><Download className="size-4" /> Owner controls</CardDescription>
      <CardTitle className="flex items-center gap-1.5 text-base">Backup<Hint text="Sessions, invitation and agent-key hashes, and the stored file bytes are deliberately excluded. After restoring you issue new links and keys, so the old ones stay dead. Checksums show which files are missing." /></CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      <p className="text-sm leading-6 text-[#63706d]">Exports the entire database as JSON: accounts, projects, permissions, conversations, messages, usage and audit events. <b>Stored files are excluded</b>; only metadata and checksums are included. Sessions and token hashes are deliberately omitted, so restored data requires new links and agent keys.</p>
      <div className="flex flex-wrap gap-2">
        <Button className="h-9 rounded-xl border-black/8 bg-white px-3" onClick={() => { window.location.href = '/api/admin/backup'; onNotice('Backup download started. Store it away from this computer.'); }} variant="outline"><Download /> Download database backup</Button>
        <Button className="h-9 rounded-xl border-black/8 bg-white px-3" disabled={busy} onClick={() => void verifyStorage()} variant="outline">{busy ? 'Checking…' : 'Verify file consistency'}</Button>
      </div>
      {check && <div className="rounded-xl bg-[#f3f5f2] p-3 text-xs leading-5">
        <p><b>{check.inDatabase}</b> files w bazie · <b>{check.inStorage}</b> objects in storage{check.truncated && ' (list truncated at 1,000)'}</p>
        {check.missingInStorage.length === 0 && check.orphanInStorage.length === 0
          ? <p className="mt-1 text-[#3c756b]">Database and storage are consistent.</p>
          : <>
            {check.missingInStorage.length > 0 && <p className="mt-1 text-red-700">Missing from storage ({check.missingInStorage.length}): {check.missingInStorage.slice(0, 5).join(', ')}{check.missingInStorage.length > 5 && ' …'}</p>}
            {check.orphanInStorage.length > 0 && <p className="mt-1 text-amber-800">Orphaned objects ({check.orphanInStorage.length}) — take up space but have no database reference.</p>}
          </>}
      </div>}
    </CardContent>
  </Card>;
}
