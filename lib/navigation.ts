// Dashboard views and their URL representation. Keeping this logic separate
// makes unknown user-entered values testable without a browser.

export const SECTIONS = ['dashboard', 'projects', 'conversations', 'team', 'usage', 'activity'] as const;

export type Section = (typeof SECTIONS)[number];

export const SECTION_PARAM = 'view';

export const DEFAULT_SECTION: Section = 'dashboard';

export const SECTION_LABELS: Record<Section, string> = {
  dashboard: 'Dashboard',
  projects: 'Projects',
  conversations: 'Conversations',
  team: 'Team',
  usage: 'API usage',
  activity: 'Activity log',
};

// Hiding the entry is only a UI convenience; server authorization remains the
// actual boundary for owner-only data.
const OWNER_ONLY: ReadonlySet<Section> = new Set(['activity']);

export function isOwnerOnlySection(section: Section): boolean {
  return OWNER_ONLY.has(section);
}

export function visibleSections(isOwner: boolean): readonly Section[] {
  return isOwner ? SECTIONS : SECTIONS.filter((section) => !OWNER_ONLY.has(section));
}

export function parseSection(value: unknown): Section {
  return typeof value === 'string' && (SECTIONS as readonly string[]).includes(value)
    ? (value as Section)
    : DEFAULT_SECTION;
}

// Keep the default URL clean and preserve unrelated query parameters.
export function sectionSearch(section: Section, current: string): string {
  const params = new URLSearchParams(current);
  if (section === DEFAULT_SECTION) params.delete(SECTION_PARAM);
  else params.set(SECTION_PARAM, section);
  const query = params.toString();
  return query ? `?${query}` : '';
}
