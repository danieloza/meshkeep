import type { TeamMember } from '@/lib/contracts/team';
import type { Project } from '@/features/projects/project';

// The people who can open a project, owner first: the owner alone, the owner
// and the people it is shared with, or the whole team. A suspended member
// cannot open anything, and an id the team list does not know is left out
// rather than drawn as a blank avatar.
export function projectPeople(project: Pick<Project, 'ownerId' | 'sharedWith' | 'visibility'>, team: TeamMember[]): TeamMember[] {
  const active = new Map(team.filter((member) => member.status === 'active').map((member) => [member.id, member]));
  const others = project.visibility === 'team' ? [...active.keys()] : project.visibility === 'selected' ? project.sharedWith : [];
  return [project.ownerId, ...others.filter((id) => id !== project.ownerId)].flatMap((id) => active.get(id) ?? []);
}
