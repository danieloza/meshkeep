import { describe, expect, it } from 'vitest';
import { projectPeople } from '@/features/projects/people';
import type { ProjectShare } from '@/lib/contracts/projects';
import type { TeamMember } from '@/lib/contracts/team';

const team: TeamMember[] = [
  { id: 'owner', displayName: 'Alex Morgan', role: 'owner', status: 'active' },
  { id: 'sam', displayName: 'Sam Lee', role: 'member', status: 'active' },
  { id: 'kim', displayName: 'Kim Park', role: 'member', status: 'active' },
  { id: 'off', displayName: 'Ola Nowak', role: 'member', status: 'suspended' },
];
const names = (people: TeamMember[]) => people.map((person) => person.displayName);
const shared = (...ids: string[]): ProjectShare[] => ids.map((memberId) => ({ memberId, role: 'reader' }));

describe('projectPeople', () => {
  it('shows only the owner of a private project', () => {
    expect(names(projectPeople({ ownerId: 'sam', sharedWith: [], visibility: 'private' }, team))).toEqual(['Sam Lee']);
  });

  it('shows the owner first, then the people a project is shared with', () => {
    expect(names(projectPeople({ ownerId: 'sam', sharedWith: shared('kim', 'owner'), visibility: 'selected' }, team))).toEqual(['Sam Lee', 'Kim Park', 'Alex Morgan']);
  });

  it('shows the whole active team for a team project, owner first', () => {
    expect(names(projectPeople({ ownerId: 'kim', sharedWith: [], visibility: 'team' }, team))).toEqual(['Kim Park', 'Alex Morgan', 'Sam Lee']);
  });

  it('leaves out suspended members, unknown ids and a repeated owner', () => {
    expect(names(projectPeople({ ownerId: 'sam', sharedWith: shared('off', 'gone', 'sam'), visibility: 'selected' }, team))).toEqual(['Sam Lee']);
  });

  it('shows nobody before the team list has loaded', () => {
    expect(projectPeople({ ownerId: 'sam', sharedWith: shared('kim'), visibility: 'selected' }, [])).toEqual([]);
  });
});
