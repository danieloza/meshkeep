'use client';

import { useState } from 'react';
import { Ban, SlidersHorizontal, UserCheck, Copy, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api-client';
import type { PendingInvite, TeamMember, TeamResponse, UpdateMemberRequest } from '@/lib/contracts/team';
import { DEFAULT_DAILY_TOKENS, DEFAULT_MONTHLY_TOKENS, limitsAreCoherent, parseLimitInput } from '@/lib/limits';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/hint';

export type TeamCapacity = TeamResponse['capacity'];

function MemberRow({ member, colorIndex, isOwnerView, currentMemberId, onChanged, onNotice }: { member: TeamMember; colorIndex: number; isOwnerView: boolean; currentMemberId: string; onChanged: () => void; onNotice: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [daily, setDaily] = useState(String(member.dailyTokens ?? DEFAULT_DAILY_TOKENS));
  const [monthly, setMonthly] = useState(String(member.monthlyTokens ?? DEFAULT_MONTHLY_TOKENS));
  const [busy, setBusy] = useState(false);

  const initials = member.displayName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toLocaleUpperCase('pl');
  const suspended = member.status === 'suspended';
  // Ownera nie da się zawiesić po stronie serwera, więc panel nawet nie
  // pokazuje takiej możliwości — inaczej kusiłby przyciskiem, który zwraca błąd.
  const canModerate = isOwnerView && member.role !== 'owner' && member.id !== currentMemberId;

  async function patch(body: UpdateMemberRequest, message: string) {
    setBusy(true);
    try {
      await api.team.updateMember(member.id, body);
      onChanged();
      onNotice(message);
    } catch (error) { onNotice(error instanceof Error ? error.message : 'Could not save the change.'); }
    finally { setBusy(false); }
  }

  function toggleSuspension() {
    if (suspended) { void patch({ status: 'active' }, `${member.displayName} can access the service again. Existing sessions remain revoked; send a reconnect link.`); return; }
    if (!window.confirm(`Suspend “${member.displayName}”? Sessions and agent keys will be revoked. Access returns only after reactivation and a new reconnect link.`)) return;
    void patch({ status: 'suspended' }, `${member.displayName} was suspended. Sessions and agent keys were revoked.`);
  }

  function saveLimits() {
    const dailyTokens = parseLimitInput(daily, 'dailyTokens');
    const monthlyTokens = parseLimitInput(monthly, 'monthlyTokens');
    if (dailyTokens === null || monthlyTokens === null) { onNotice('Limits must be whole numbers within the allowed range.'); return; }
    if (!limitsAreCoherent(dailyTokens, monthlyTokens)) { onNotice('The monthly limit cannot be lower than the daily limit.'); return; }
    void patch({ dailyTokens, monthlyTokens }, `Limits saved for ${member.displayName}.`);
  }

  return <div className="rounded-xl border border-black/6 bg-white/60 p-2">
    <div className="flex items-center gap-3">
      <Avatar className={['bg-[#d7ece7]', 'bg-[#f1e4d7]', 'bg-[#e5e1f1]', 'bg-[#dfe7f1]'][colorIndex % 4]} size="sm"><AvatarFallback className="bg-transparent text-[9px] font-semibold">{initials}</AvatarFallback></Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{member.displayName}{member.id === currentMemberId && <span className="ml-1 text-[11px] font-normal text-[#818b89]">(to Ty)</span>}</p>
        <p className="text-[11px] text-[#818b89]">{member.role === 'owner' ? 'Owner' : 'Member'}{suspended && ' · suspended'}{member.apiEnabled === false && ' · API disabled'}</p>
      </div>
      {isOwnerView && <Button aria-label={`Limits for ${member.displayName}`} onClick={() => setOpen((value) => !value)} size="icon-xs" title="Token limits" variant="ghost"><SlidersHorizontal /></Button>}
      {canModerate && <Button aria-label={suspended ? `Reactivate ${member.displayName}` : `Suspend ${member.displayName}`} disabled={busy} onClick={toggleSuspension} size="icon-xs" title={suspended ? 'Restore access' : 'Suspend account'} variant="ghost">{suspended ? <UserCheck /> : <Ban />}</Button>}
      <span className={cn('size-2 shrink-0 rounded-full', suspended ? 'bg-red-400' : 'bg-emerald-400')} />
    </div>
    {open && isOwnerView && <div className="mt-2 space-y-2 border-t border-black/6 pt-2">
      <div className="flex gap-2">
        <div className="flex-1"><label className="text-[11px] text-[#7a8582]" htmlFor={`limit-daily-${member.id}`}>Daily</label>
          <Input className="mt-1 h-8 bg-white text-xs" id={`limit-daily-${member.id}`} inputMode="numeric" onChange={(event) => setDaily(event.target.value)} value={daily} /></div>
        <div className="flex-1"><label className="text-[11px] text-[#7a8582]" htmlFor={`limit-monthly-${member.id}`}>Monthly</label>
          <Input className="mt-1 h-8 bg-white text-xs" id={`limit-monthly-${member.id}`} inputMode="numeric" onChange={(event) => setMonthly(event.target.value)} value={monthly} /></div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[11px] text-[#7a8582]">
          <input checked={member.apiEnabled !== false} disabled={busy} onChange={(event) => void patch({ apiEnabled: event.target.checked }, event.target.checked ? `Model access enabled for ${member.displayName}.` : `Model access disabled for ${member.displayName}.`)} type="checkbox" />
          Model access
        </label>
        <Button disabled={busy} onClick={saveLimits} size="sm" variant="outline">{busy ? '…' : 'Save limits'}</Button>
      </div>
    </div>}
  </div>;
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
  return <Card className="border-0 bg-white/90 shadow-none ring-black/6"><CardHeader><CardTitle className="flex items-center gap-1.5 text-base">Team<Hint text="Reusing an email that already belongs to a member creates a reconnect link rather than a second account, and takes no extra seat. Revoking an unused invitation frees its seat immediately." /></CardTitle><CardDescription>{used} of {capacity.total} seats used or reserved</CardDescription></CardHeader><CardContent className="space-y-3">{members.map((member, index) => <MemberRow key={member.id} colorIndex={index} currentMemberId={currentMemberId} isOwnerView={canInvite} member={member} onChanged={onTeamChanged} onNotice={onNotice} />)}{pendingInvites.map((invite) => <div className="flex items-center gap-3 text-xs" key={invite.id}><Avatar className="bg-stone-100" size="sm"><AvatarFallback className="bg-transparent text-[9px]">?</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate font-medium">{invite.email}</p><p className="text-[11px] text-[#929b98]">Waiting for link use · expires {new Date(invite.expiresAt).toLocaleDateString('en-US')}</p></div>{canInvite ? <Button aria-label={`Revoke invitation for ${invite.email}`} onClick={() => void revokeInvite(invite.id)} size="icon-xs" title="Revoke invitation and release seat" variant="ghost"><Trash2 /></Button> : <span className="size-2 rounded-full bg-amber-300" />}</div>)}{reconnectLinks.map((link) => <div className="flex items-center gap-3 text-xs" key={link.id}><Avatar className="bg-sky-50" size="sm"><AvatarFallback className="bg-transparent text-[9px]">↻</AvatarFallback></Avatar><div className="min-w-0 flex-1"><p className="truncate font-medium">{link.email}</p><p className="text-[11px] text-[#929b98]">Unused reconnect link · does not use a seat</p></div><Button aria-label={`Invalidate reconnect link for ${link.email}`} onClick={() => void revokeInvite(link.id)} size="icon-xs" title="Invalidate link" variant="ghost"><Trash2 /></Button></div>)}{canInvite && <form className="space-y-2 pt-2" onSubmit={(event) => { event.preventDefault(); void invite(); }}><div className="flex gap-2"><Input aria-label="Invitee email" className="h-8 min-w-0 text-xs" onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" type="email" value={email} /><Button disabled={!email.trim() || inviting} size="sm" type="submit">{inviting ? '…' : isReconnect ? 'Reconnect' : 'Invite'}</Button></div><p className="text-[10px] leading-4 text-[#8b9491]">{isReconnect ? 'This address already belongs to a member. You will receive a reconnect link for the existing account.' : used >= capacity.total ? 'All seats are occupied. Revoke an invitation above or enter an existing member’s address.' : 'A new invitation reserves one available seat.'}</p></form>}{canInvite && inviteLink && <div className="rounded-xl border border-emerald-800/10 bg-emerald-50 p-3"><p className="mb-2 text-[11px] leading-4 text-emerald-900/75">{inviteKind === 'reconnect' ? 'Reconnect link for an existing account. Treat it like a password and send it directly.' : 'This is a one-time link. Send it directly to your teammate and never publish it.'}</p><div className="flex gap-2"><Input aria-label="One-time invitation link" className="h-8 min-w-0 bg-white text-[10px]" readOnly value={inviteLink} /><Button onClick={() => { void navigator.clipboard.writeText(inviteLink); onNotice('Invitation link copied.'); }} size="icon-sm" title="Copy link" type="button" variant="outline"><Copy /></Button></div></div>}</CardContent></Card>;
}
