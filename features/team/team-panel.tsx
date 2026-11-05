'use client';

import { useState } from 'react';
import { Ban, UserCheck } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import { initials } from '@/lib/format';
import type { PendingInvite, TeamMember, TeamResponse } from '@/lib/contracts/team';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/hint';
import { InviteCard } from './invite-card';

export type TeamCapacity = TeamResponse['capacity'];

function MemberRow({ member, colorIndex, isOwnerView, currentMemberId, onChanged, onNotice }: { member: TeamMember; colorIndex: number; isOwnerView: boolean; currentMemberId: string; onChanged: () => void; onNotice: (message: string) => void }) {
  const [busy, setBusy] = useState(false);

  const suspended = member.status === 'suspended';
  // Ownera nie da się zawiesić po stronie serwera, więc panel nawet nie
  // pokazuje takiej możliwości — inaczej kusiłby przyciskiem, który zwraca błąd.
  const canModerate = isOwnerView && member.role !== 'owner' && member.id !== currentMemberId;

  async function setStatus(status: 'active' | 'suspended', message: string) {
    setBusy(true);
    try {
      await api.team.updateMember(member.id, { status });
      onChanged();
      onNotice(message);
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not save the change.'); }
    finally { setBusy(false); }
  }

  function toggleSuspension() {
    if (suspended) { void setStatus('active', `${member.displayName} can access the service again. Existing sessions remain revoked; send a reconnect link.`); return; }
    if (!window.confirm(`Suspend “${member.displayName}”? Sessions and agent keys will be revoked. Access returns only after reactivation and a new reconnect link.`)) return;
    void setStatus('suspended', `${member.displayName} was suspended. Sessions and agent keys were revoked.`);
  }

  return <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-3 last:border-b-0">
    <Avatar className={['bg-avatar-1', 'bg-avatar-2', 'bg-avatar-3', 'bg-avatar-4'][colorIndex % 4]} size="sm"><AvatarFallback className="bg-transparent text-[9px] font-semibold text-ink-soft">{initials(member.displayName)}</AvatarFallback></Avatar>
    <span className="min-w-0 flex-1 basis-44">
      <span className="block truncate text-sm font-medium">{member.displayName}{member.id === currentMemberId && <span className="text-xs font-normal text-ink-subtle"> (you)</span>}</span>
      {member.email && <span className="block truncate font-mono text-xs text-ink-subtle">{member.email}</span>}
    </span>
    <span className="w-16 text-xs text-ink-muted">{member.role === 'owner' ? 'Owner' : 'Member'}</span>
    <span className="w-28 text-xs">
      <span className={cn('block font-medium', suspended ? 'text-danger-text' : 'text-ok-text')}>{suspended ? 'Suspended' : 'Active'}</span>
      {member.apiEnabled === false && <span className="block text-warn-text">Model access off</span>}
    </span>
    {canModerate
      ? <Button disabled={busy} onClick={toggleSuspension} size="sm" variant="outline">{suspended ? <UserCheck /> : <Ban />}{suspended ? 'Reactivate' : 'Suspend'}</Button>
      : <span aria-hidden className="hidden w-[104px] sm:block" />}
  </li>;
}

// The owner gets the invite card above the list; everyone else sees the list.
export function TeamPanel({ members, pendingInvites, reconnectLinks, capacity, canInvite, currentMemberId, onTeamChanged, onNotice }: { members: TeamMember[]; pendingInvites: PendingInvite[]; reconnectLinks: PendingInvite[]; capacity: TeamCapacity; canInvite: boolean; currentMemberId: string; onTeamChanged: () => void; onNotice: (message: string) => void }) {
  const memberEmails = members.map((member) => member.email).filter((value): value is string => Boolean(value));
  return <div className="space-y-6">
    {canInvite && <InviteCard capacity={capacity} memberEmails={memberEmails} onNotice={onNotice} onTeamChanged={onTeamChanged} pendingInvites={pendingInvites} reconnectLinks={reconnectLinks} />}
    <Card className="border-0 bg-surface-raised/90 shadow-none ring-line"><CardHeader><CardTitle className="flex items-center gap-1.5 text-base">Team<Hint text="Inviting an address that already belongs to a member creates a reconnect link rather than a second account, and takes no extra seat. Revoking an unused link frees its seat immediately." /></CardTitle><CardDescription>{capacity.used} of {capacity.total} seats used or reserved</CardDescription></CardHeader><CardContent className="space-y-3"><ul aria-label="Team members" className="-mt-2">{members.map((member, index) => <MemberRow key={member.id} colorIndex={index} currentMemberId={currentMemberId} isOwnerView={canInvite} member={member} onChanged={onTeamChanged} onNotice={onNotice} />)}</ul>{canInvite && <p className="text-xs leading-5 text-ink-subtle">Suspending revokes the person’s sessions and agent keys. Token limits and model access are set per person under Usage and limits.</p>}</CardContent></Card>
  </div>;
}
