import type { ShareRole, Visibility } from '@/lib/contracts/common';
import type { ProjectShare, UpdateSharingRequest } from '@/lib/contracts/projects';
import type { TeamMember } from '@/lib/contracts/team';

// A team has four seats, so a project shared with selected people has its
// owner and at most three others. The server holds the same limit.
export const MAX_SHARED_PEOPLE = 3;

// Someone added from the panel can read until the owner says otherwise.
export const DEFAULT_SHARE_ROLE: ShareRole = 'reader';

export function addShare(shares: ProjectShare[], memberId: string): ProjectShare[] {
  if (shares.some((share) => share.memberId === memberId) || shares.length >= MAX_SHARED_PEOPLE) return shares;
  return [...shares, { memberId, role: DEFAULT_SHARE_ROLE }];
}

export function removeShare(shares: ProjectShare[], memberId: string): ProjectShare[] {
  return shares.filter((share) => share.memberId !== memberId);
}

export function changeShareRole(shares: ProjectShare[], memberId: string, role: ShareRole): ProjectShare[] {
  return shares.map((share) => share.memberId === memberId ? { ...share, role } : share);
}

// The body for PATCH /api/projects/[id]. The server keeps shares only for
// `selected`, so the other two send none rather than ones it would drop.
export function sharingRequest(visibility: Visibility, shares: ProjectShare[]): UpdateSharingRequest {
  return { visibility, members: visibility === 'selected' ? shares : [] };
}

// Active teammates the project is not shared with yet, in team order.
export function addablePeople(team: TeamMember[], ownerId: string, shares: ProjectShare[]): TeamMember[] {
  const shared = new Set(shares.map((share) => share.memberId));
  return team.filter((member) => member.status === 'active' && member.id !== ownerId && !shared.has(member.id));
}
