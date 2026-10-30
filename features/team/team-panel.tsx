'use client';

import { useState } from 'react';
import { Ban, UserCheck, Copy, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import type { PendingInvite, TeamMember, TeamResponse } from '@/lib/contracts/team';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/hint';

export type TeamCapacity = TeamResponse['capacity'];

function MemberRow({ member, colorIndex, isOwnerView, currentMemberId, onChanged, onNotice }: { member: TeamMember; colorIndex: number; isOwnerView: boolean; currentMemberId: string; onChanged: () => void; onNotice: (message: string) => void }) {
  const [busy, setBusy] = useState(false);

  const initials = member.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toLocaleUpperCase('pl');
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
    <Avatar className={['bg-avatar-1', 'bg-avatar-2', 'bg-avatar-3', 'bg-avatar-4'][colorIndex % 4]} size="sm"><AvatarFallback className="bg-transparent text-[9px] font-semibold text-ink-soft">{initials}</AvatarFallback></Avatar>
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

export function TeamPanel({ members, pendingInvites, reconnectLinks, capacity, canInvite, currentMemberId, onTeamChanged, onNotice }: { members: TeamMember[]; pendingInvites: PendingInvite[]; reconnectLinks: PendingInvite[]; capacity: TeamCapacity; canInvite: boolean; currentMemberId: string; onTeamChanged: () => void; onNotice: (message: string) => void }) {
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [inviteKind, setInviteKind] = useState<'invite' | 'reconnect'>('invite');
  const used = capacity.used;
  const memberEmails = new Set(members.map((member) => member.email).filter((value): value is string => Boolean(value)));
  const isReconnect = memberEmails.has(email.trim().toLocaleLowerCase('en-US'));
  async function invite() {
    const normalized = email.trim();
    if (!normalized || inviting) return;
    setInviting(true);
    try {
      const { invite } = await api.team.invite({ email: normalized });
      if (!invite.joinPath.startsWith('/join?token=')) throw new Error('The server returned an invalid invitation link.');
      const kind = invite.kind;
      setInviteKind(kind);
      setInviteLink(new URL(invite.joinPath, window.location.origin).toString());
      setEmail('');
      onTeamChanged();
      onNotice(kind === 'reconnect' ? 'The reconnect link is ready. It restores the existing account without using another seat.' : 'The one-time link is ready. Copy it and send it directly to the invitee.');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not invite this person.'); }
    finally { setInviting(false); }
  }
  async function revokeInvite(inviteId: string) {
    try {
      await api.team.revokeInvite({ id: inviteId });
      onTeamChanged();
      onNotice('Invitation revoked. The seat is available again.');
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not revoke the invitation.'); }
  }
  return <Card className="border-0 bg-surface-raised/90 shadow-none ring-line"><CardHeader><CardTitle className="flex items-center gap-1.5 text-base">Team<Hint text="Reusing an email that already belongs to a member creates a reconnect link rather than a second account, and takes no extra seat. Revoking an unused invitation frees its seat immediately." /></CardTitle><CardDescription>{used} of {capacity.total} seats used or reserved</CardDescription></CardHeader><CardContent className="space-y-3"><ul aria-label="Team members" className="-mt-2">{members.map((member, index) => <MemberRow key={member.id} colorIndex={index} currentMemberId={currentMemberId} isOwnerView={canInvite} member={member} onChanged={onTeamChanged} onNotice={onNotice} />)}</ul>{canInvite && <p className="text-xs leading-5 text-ink-subtle">Suspending revokes the person’s sessions and agent keys. Token limits and model access are set per person under Usage and limits.</p>}{pendingInvites.map((invite) => <div className="flex items-center gap-3 text-xs" key={invite.id}><Avatar className="bg-avatar-pending" size="sm"><AvatarFallback className="bg-transparent text-[9px] text-ink-soft">?</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate font-medium">{invite.email}</p><p className="text-[11px] text-ink-subtle">Waiting for link use · expires {new Date(invite.expiresAt).toLocaleDateString('en-US')}</p></div>{canInvite ? <Button aria-label={`Revoke invitation for ${invite.email}`} onClick={() => void revokeInvite(invite.id)} size="icon-xs" title="Revoke invitation and release seat" variant="ghost"><Trash2 /></Button> : <span className="size-2 rounded-full bg-amber-300" />}</div>)}{reconnectLinks.map((link) => <div className="flex items-center gap-3 text-xs" key={link.id}><Avatar className="bg-avatar-reconnect" size="sm"><AvatarFallback className="bg-transparent text-[9px] text-ink-soft">↻</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate font-medium">{link.email}</p><p className="text-[11px] text-ink-subtle">Unused reconnect link · does not use a seat</p></div><Button aria-label={`Invalidate reconnect link for ${link.email}`} onClick={() => void revokeInvite(link.id)} size="icon-xs" title="Invalidate link" variant="ghost"><Trash2 /></Button></div>)}{canInvite && <form className="space-y-2 pt-2" onSubmit={(event) => { event.preventDefault(); void invite(); }}><div className="flex gap-2"><Input aria-label="Invitee email" className="h-8 min-w-0 text-xs" onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" type="email" value={email} /><Button disabled={!email.trim() || inviting} size="sm" type="submit">{inviting ? '…' : isReconnect ? 'Reconnect' : 'Invite'}</Button></div><p className="text-[10px] leading-4 text-ink-subtle">{isReconnect ? 'This address already belongs to a member. You will receive a reconnect link for the existing account.' : used >= capacity.total ? 'All seats are occupied. Revoke an invitation above or enter an existing member’s address.' : 'A new invitation reserves one available seat.'}</p></form>}{canInvite && inviteLink && <div className="rounded-xl border border-emerald-800/10 bg-ok-soft p-3"><p className="mb-2 text-[11px] leading-4 text-ok-text">{inviteKind === 'reconnect' ? 'Reconnect link for an existing account. Treat it like a password and send it directly.' : 'This is a one-time link. Send it directly to your teammate and never publish it.'}</p><div className="flex gap-2"><Input aria-label="One-time invitation link" className="h-8 min-w-0 bg-surface-raised text-[10px] dark:bg-surface-raised" readOnly value={inviteLink} /><Button onClick={() => { void navigator.clipboard.writeText(inviteLink); onNotice('Invitation link copied.'); }} size="icon-sm" title="Copy link" type="button" variant="outline"><Copy /></Button></div></div>}</CardContent></Card>;
}
