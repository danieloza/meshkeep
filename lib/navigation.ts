// Dashboard views and their URL representation. Keeping this logic separate
// makes unknown user-entered values testable without a browser.

export const SECTIONS = ['dashboard', 'projects', 'conversations', 'team', 'providers', 'usage', 'sync', 'activity', 'safety'] as const;

export type Section = (typeof SECTIONS)[number];

export const SECTION_PARAM = 'view';

export const DEFAULT_SECTION: Section = 'dashboard';

export const SECTION_LABELS: Record<Section, string> = {
  dashboard: 'Home',
  projects: 'Projects',
  conversations: 'Conversations',
  team: 'Team',
  providers: 'Model providers',
  usage: 'Usage and limits',
  sync: 'Folder sync',
  activity: 'Activity',
  safety: 'Backup and safety',
};

// Hiding the entry is only a UI convenience; server authorization remains the
// actual boundary for owner-only data.
const OWNER_ONLY: ReadonlySet<Section> = new Set(['activity', 'safety']);

export function isOwnerOnlySection(section: Section): boolean {
  return OWNER_ONLY.has(section);
}

export function visibleSections(isOwner: boolean): readonly Section[] {
  return isOwner ? SECTIONS : SECTIONS.filter((section) => !OWNER_ONLY.has(section));
}

// The Settings page, at its own path, holds everything that is not a project:
// the team, providers, usage, folder sync, activity, backup and safety. Home,
// conversations and projects stay in the workspace at `/`.
const SETTINGS: ReadonlySet<Section> = new Set(['team', 'providers', 'usage', 'sync', 'activity', 'safety']);

export const SETTINGS_PATH = '/settings';

export const DEFAULT_SETTINGS_SECTION: Section = 'team';

export function isSettingsSection(section: Section): boolean {
  return SETTINGS.has(section);
}

export function visibleSettingsSections(isOwner: boolean): readonly Section[] {
  return visibleSections(isOwner).filter(isSettingsSection);
}

export function sectionPath(section: Section): string {
  return isSettingsSection(section) ? SETTINGS_PATH : '/';
}

// The view an address opens. `/settings` without a settings view opens the
// team; `/?view=team`, from before the page existed, still opens it too.
export function sectionFromLocation(pathname: string, search: string): Section {
  const section = parseSection(new URLSearchParams(search).get(SECTION_PARAM));
  const onSettings = pathname.replace(/\/+$/, '') === SETTINGS_PATH;
  return onSettings && !isSettingsSection(section) ? DEFAULT_SETTINGS_SECTION : section;
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

// The open project and its conversation, beside the view underneath them, so
// a reload, a shared link or Back returns to the same chat.
export const PROJECT_PARAM = 'project';
export const CONVERSATION_PARAM = 'conversation';
export const NEW_CONVERSATION = 'new';

// `conversation` is a conversation id, NEW_CONVERSATION, or null for the
// project's latest conversation.
export type ChatTarget = { projectId: string; conversation: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only well-formed ids leave the address bar; anything else opens nothing.
export function parseChatTarget(current: string): ChatTarget | null {
  const params = new URLSearchParams(current);
  const projectId = params.get(PROJECT_PARAM);
  if (!projectId || !UUID.test(projectId)) return null;
  const conversation = params.get(CONVERSATION_PARAM);
  return { projectId, conversation: conversation === NEW_CONVERSATION || (conversation && UUID.test(conversation)) ? conversation : null };
}

// `null` closes the chat. The view and unrelated parameters stay.
export function chatSearch(target: ChatTarget | null, current: string): string {
  const params = new URLSearchParams(current);
  params.delete(PROJECT_PARAM);
  params.delete(CONVERSATION_PARAM);
  if (target) {
    params.set(PROJECT_PARAM, target.projectId);
    if (target.conversation) params.set(CONVERSATION_PARAM, target.conversation);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}
