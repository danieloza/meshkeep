'use client';

import { useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { ChevronDown, Loader2, Plus, X } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { api, ApiRequestError } from '@/lib/api-client';
import type { ShareRole, Visibility } from '@/lib/contracts/common';
import type { ProjectShare } from '@/lib/contracts/projects';
import type { TeamMember } from '@/lib/contracts/team';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { projectPeople } from '@/features/projects/people';
import { type Project, visibilityBadgeClasses, visibilityLabels } from '@/features/projects/project';
import { addablePeople, addShare, changeShareRole, MAX_SHARED_PEOPLE, removeShare, sharingRequest } from '@/features/projects/sharing';

export type ProjectSharing = { visibility: Visibility; sharedWith: ProjectShare[] };

const VISIBILITIES: Visibility[] = ['private', 'selected', 'team'];
const AVATAR_COLORS = ['bg-avatar-1', 'bg-avatar-2', 'bg-avatar-3', 'bg-avatar-4'];
const ROLE_LABELS: Record<ShareRole, string> = { reader: 'Reader', editor: 'Editor' };

// Who can open the project, from the chat header. The trigger shows the
// people and the project's visibility; the panel lets the owner change both
// at any time, and shows everyone else the same list without controls. Each
// change is saved at once, since the server replaces the whole share list.
export function ProjectPeople({ project, team, currentMemberId, onChange }: { project: Project; team: TeamMember[]; currentMemberId: string; onChange: (sharing: ProjectSharing) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = project.ownerId === currentMemberId;
  const people = projectPeople(project, team);
  const byId = new Map(team.map((member, index) => [member.id, { member, color: AVATAR_COLORS[index % AVATAR_COLORS.length] }]));
  const shares = project.visibility === 'selected' ? project.sharedWith : [];

  async function save(visibility: Visibility, next: ProjectShare[]) {
    setBusy(true);
    setError(null);
    try {
      const { project: saved } = await api.projects.updateSharing(project.id, sharingRequest(visibility, next));
      onChange({ visibility: saved.visibility, sharedWith: saved.members });
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'Access could not be changed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const face = (memberId: string, size: 'sm' | 'default' = 'default') => {
    const known = byId.get(memberId);
    return <Avatar className={cn(size === 'sm' ? 'size-6 ring-2 ring-surface' : 'size-7', known?.color ?? 'bg-surface-fill')} size="sm"><AvatarFallback className="bg-transparent text-[10px] font-semibold text-ink-soft">{known ? initials(known.member.displayName) : '?'}</AvatarFallback></Avatar>;
  };
  const nameOf = (memberId: string) => {
    const known = byId.get(memberId)?.member;
    if (!known) return 'Former member';
    return known.status === 'active' ? known.displayName : `${known.displayName} (suspended)`;
  };
  const you = (memberId: string) => memberId === currentMemberId ? <span className="text-ink-subtle"> (you)</span> : null;
  const row = 'flex min-h-11 items-center gap-2.5 py-1.5';

  const others = project.visibility === 'team' ? team.filter((member) => member.status === 'active' && member.id !== project.ownerId) : [];
  const addable = isOwner && project.visibility === 'selected' ? addablePeople(team, project.ownerId, shares) : [];
  const full = shares.length >= MAX_SHARED_PEOPLE;

  return <Popover.Root onOpenChange={(open) => { if (!open) setError(null); }}>
    <Popover.Trigger aria-label={`${visibilityLabels[project.visibility]}, ${people.length} ${people.length === 1 ? 'person' : 'people'}. ${isOwner ? 'Manage access' : 'See who has access'}`} className={cn('inline-flex h-8 shrink-0 items-center gap-2 rounded-full pr-2.5 text-xs font-medium outline-none transition hover:brightness-[.97] focus-visible:ring-2 focus-visible:ring-ring/50 data-[popup-open]:brightness-[.95]', people.length ? 'pl-1' : 'pl-2.5', visibilityBadgeClasses[project.visibility])}>
      {people.length > 0 && <span aria-hidden className="flex -space-x-0.5">{people.slice(0, 4).map((person) => <span key={person.id}>{face(person.id, 'sm')}</span>)}</span>}
      <span>{visibilityLabels[project.visibility]}</span>
      <ChevronDown aria-hidden className="size-3.5" />
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Positioner align="end" className="isolate z-[85]" sideOffset={8}>
        <Popover.Popup className="w-[min(24rem,calc(100vw-2rem))] origin-(--transform-origin) rounded-2xl border border-line bg-surface-raised p-4 text-sm text-ink shadow-xl outline-none data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
          <div className="flex items-center justify-between gap-3">
            <Popover.Title className="font-semibold">People in this project</Popover.Title>
            {busy && <Loader2 aria-label="Saving" className="size-4 animate-spin text-ink-subtle" />}
          </div>

          {isOwner && <fieldset className="mt-3 grid min-w-0 grid-cols-3 gap-1 rounded-xl bg-surface-fill p-1">
            <legend className="sr-only">Who can open this project</legend>
            {VISIBILITIES.map((visibility) => <button aria-pressed={project.visibility === visibility} className={cn('min-h-9 whitespace-nowrap rounded-lg px-1.5 text-xs font-medium transition', project.visibility === visibility ? 'bg-surface-raised text-ink shadow-sm' : 'text-ink-muted hover:text-ink')} disabled={busy} key={visibility} onClick={() => { if (visibility !== project.visibility) void save(visibility, visibility === 'selected' ? project.sharedWith : []); }} type="button">{visibilityLabels[visibility]}</button>)}
          </fieldset>}

          <ul className="mt-2 divide-y divide-line">
            <li className={row}>{face(project.ownerId)}<span className="min-w-0 flex-1 truncate">{nameOf(project.ownerId)}{you(project.ownerId)}</span><span className="text-xs text-ink-subtle">Owner</span></li>
            {shares.map((share) => <li className={row} key={share.memberId}>
              {face(share.memberId)}
              <span className="min-w-0 flex-1 truncate">{nameOf(share.memberId)}{you(share.memberId)}</span>
              {isOwner
                ? <>
                  <select aria-label={`Role of ${nameOf(share.memberId)}`} className="h-8 rounded-lg border border-line-strong bg-surface-raised px-2 text-xs" disabled={busy} onChange={(event) => void save('selected', changeShareRole(shares, share.memberId, event.target.value as ShareRole))} value={share.role}>
                    <option value="reader">{ROLE_LABELS.reader}</option>
                    <option value="editor">{ROLE_LABELS.editor}</option>
                  </select>
                  <button aria-label={`Remove ${nameOf(share.memberId)}`} className="grid size-8 place-items-center rounded-lg text-ink-subtle transition hover:bg-surface-fill hover:text-danger-text" disabled={busy} onClick={() => void save('selected', removeShare(shares, share.memberId))} type="button"><X className="size-4" /></button>
                </>
                : <span className="text-xs text-ink-subtle">{ROLE_LABELS[share.role]}</span>}
            </li>)}
            {others.map((member) => <li className={row} key={member.id}>{face(member.id)}<span className="min-w-0 flex-1 truncate">{member.displayName}{you(member.id)}</span><span className="text-xs text-ink-subtle">{ROLE_LABELS.reader}</span></li>)}
          </ul>

          {project.visibility === 'private' && <p className="mt-1 text-xs leading-5 text-ink-muted">Only {isOwner ? 'you' : 'the owner'} can open this project.</p>}
          {project.visibility === 'team' && isOwner && <p className="mt-1 text-xs leading-5 text-ink-muted">Everyone on the team can read it. Only you can edit. Choose Selected people to let someone edit.</p>}

          {addable.length > 0 && <div className="mt-3 border-t border-line pt-2">
            <p className="py-1 text-xs font-medium text-ink-muted">{full ? `Shared with ${MAX_SHARED_PEOPLE} people, the most a project can have.` : 'Add from your team'}</p>
            <ul>{addable.map((member) => <li className={row} key={member.id}>
              {face(member.id)}
              <span className="min-w-0 flex-1 truncate text-ink-muted">{member.displayName}</span>
              <button className="inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong px-2.5 text-xs font-medium transition hover:bg-surface-fill disabled:opacity-50" disabled={busy || full} onClick={() => void save('selected', addShare(shares, member.id))} type="button"><Plus className="size-3.5" />Add</button>
            </li>)}</ul>
          </div>}

          {error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger-text" role="alert">{error}</p>}

          <Popover.Description className="mt-3 border-t border-line pt-3 text-xs leading-5 text-ink-subtle">
            {isOwner
              ? 'People here see every conversation and file in this project, including earlier ones. Removing someone takes effect on their next request.'
              : 'Only the project’s owner can change who has access.'}
          </Popover.Description>
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}
