import { describe, expect, it } from 'vitest';
import { addablePeople, addShare, changeShareRole, MAX_SHARED_PEOPLE, removeShare, sharingRequest } from '@/features/projects/sharing';
import type { ProjectShare } from '@/lib/contracts/projects';
import type { TeamMember } from '@/lib/contracts/team';

const team: TeamMember[] = [
  { id: 'owner', displayName: 'Alex Morgan', role: 'owner', status: 'active' },
  { id: 'ana', displayName: 'Ana Silva', role: 'member', status: 'active' },
  { id: 'tom', displayName: 'Tomek Nowak', role: 'member', status: 'active' },
  { id: 'off', displayName: 'Ola Nowak', role: 'member', status: 'suspended' },
];
const ana: ProjectShare = { memberId: 'ana', role: 'editor' };

describe('sharing changes from the people panel', () => {
  it('adds a person as a reader, once', () => {
    expect(addShare([], 'tom')).toEqual([{ memberId: 'tom', role: 'reader' }]);
    expect(addShare([ana], 'ana')).toEqual([ana]);
  });

  it('adds nobody past the limit', () => {
    const full = ['a', 'b', 'c'].map((memberId): ProjectShare => ({ memberId, role: 'reader' }));
    expect(full).toHaveLength(MAX_SHARED_PEOPLE);
    expect(addShare(full, 'd')).toBe(full);
  });

  it('removes a person and changes a role without touching the others', () => {
    const shares: ProjectShare[] = [ana, { memberId: 'tom', role: 'reader' }];
    expect(removeShare(shares, 'ana')).toEqual([{ memberId: 'tom', role: 'reader' }]);
    expect(changeShareRole(shares, 'tom', 'editor')).toEqual([ana, { memberId: 'tom', role: 'editor' }]);
  });

  it('sends shares only for selected people', () => {
    expect(sharingRequest('selected', [ana])).toEqual({ visibility: 'selected', members: [ana] });
    expect(sharingRequest('team', [ana])).toEqual({ visibility: 'team', members: [] });
    expect(sharingRequest('private', [ana])).toEqual({ visibility: 'private', members: [] });
  });

  it('offers active teammates who are not the owner and not shared yet', () => {
    expect(addablePeople(team, 'owner', [ana]).map((member) => member.id)).toEqual(['tom']);
    expect(addablePeople(team, 'ana', []).map((member) => member.id)).toEqual(['owner', 'tom']);
  });
});
