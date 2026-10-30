import { describe, expect, it } from 'vitest';
import {
  chatSearch,
  DEFAULT_SECTION,
  NEW_CONVERSATION,
  parseChatTarget,
  isOwnerOnlySection,
  isSettingsSection,
  sectionFromLocation,
  sectionPath,
  parseSection,
  SECTION_LABELS,
  SECTIONS,
  sectionSearch,
  visibleSections,
  visibleSettingsSections,
} from '@/lib/navigation';

describe('parseSection', () => {
  it('recognizes every declared view', () => {
    for (const section of SECTIONS) {
      expect(parseSection(section)).toBe(section);
    }
  });

  it('falls back to the dashboard for an unknown or missing value', () => {
    for (const value of [null, undefined, '', 'Dashboard', 'settings', '../etc', 42, {}, []]) {
      expect(parseSection(value), String(value)).toBe(DEFAULT_SECTION);
    }
  });
});

describe('sectionSearch', () => {
  it('keeps the default view URL clean', () => {
    expect(sectionSearch('dashboard', '')).toBe('');
    expect(sectionSearch('dashboard', '?view=team')).toBe('');
  });

  it('sets the parameter for other views', () => {
    expect(sectionSearch('conversations', '')).toBe('?view=conversations');
    expect(sectionSearch('usage', '?view=team')).toBe('?view=usage');
  });

  it('preserves unrelated parameters', () => {
    expect(sectionSearch('team', '?token=abc')).toBe('?token=abc&view=team');
    expect(sectionSearch('dashboard', '?token=abc&view=conversations')).toBe('?token=abc');
  });

  it('round-trips every view through the URL', () => {
    for (const section of SECTIONS) {
      const search = sectionSearch(section, '');
      expect(parseSection(new URLSearchParams(search).get('view'))).toBe(section);
    }
  });
});

describe('labels', () => {
  it('provides an English label for every view', () => {
    for (const section of SECTIONS) {
      expect(SECTION_LABELS[section]).toBeTruthy();
    }
  });
});

describe('owner-only views', () => {
  it('restricts the activity log and backup and safety to the owner', () => {
    expect(isOwnerOnlySection('activity')).toBe(true);
    expect(isOwnerOnlySection('safety')).toBe(true);
    expect(visibleSections(true)).toContain('activity');
    expect(visibleSections(false)).not.toContain('activity');
  });

  it('shows all other views to every member', () => {
    for (const section of ['dashboard', 'projects', 'conversations', 'team', 'providers', 'usage', 'sync'] as const) {
      expect(isOwnerOnlySection(section), section).toBe(false);
      expect(visibleSections(false), section).toContain(section);
    }
  });

  // The hidden menu entry is a convenience, not an authorization boundary.
  // The render path and API remain responsible for enforcing owner access.
  it('still parses the activity view when it is hidden from the menu', () => {
    expect(parseSection('activity')).toBe('activity');
  });
});

describe('settings views', () => {
  it('puts everything that is not a project under Settings', () => {
    expect(SECTIONS.filter(isSettingsSection)).toEqual(['team', 'providers', 'usage', 'sync', 'activity', 'safety']);
  });

  it('keeps home, conversations and projects out of Settings', () => {
    for (const section of ['dashboard', 'projects', 'conversations'] as const) {
      expect(isSettingsSection(section), section).toBe(false);
    }
  });

  it('hides the owner-only sections from members in Settings too', () => {
    expect(visibleSettingsSections(true)).toEqual(['team', 'providers', 'usage', 'sync', 'activity', 'safety']);
    expect(visibleSettingsSections(false)).toEqual(['team', 'providers', 'usage', 'sync']);
  });

  it('serves settings views from /settings and the workspace from /', () => {
    expect(sectionPath('providers')).toBe('/settings');
    expect(sectionPath('safety')).toBe('/settings');
    expect(sectionPath('dashboard')).toBe('/');
    expect(sectionPath('conversations')).toBe('/');
  });

  it('opens the team on /settings without a settings view', () => {
    expect(sectionFromLocation('/settings', '')).toBe('team');
    expect(sectionFromLocation('/settings/', '?view=projects')).toBe('team');
    expect(sectionFromLocation('/settings', '?view=nonsense')).toBe('team');
    expect(sectionFromLocation('/settings', '?view=usage')).toBe('usage');
  });

  it('keeps old /?view= links to settings views working', () => {
    expect(sectionFromLocation('/', '?view=team')).toBe('team');
    expect(sectionFromLocation('/', '?view=activity')).toBe('activity');
    expect(sectionFromLocation('/', '')).toBe('dashboard');
  });
});

describe('the open project in the URL', () => {
  const project = '20000000-0000-4000-8000-000000000001';
  const conversation = '40000000-0000-4000-8000-000000000002';

  it('reads a project with its conversation, a new one, or its latest', () => {
    expect(parseChatTarget(`?project=${project}&conversation=${conversation}`)).toEqual({ projectId: project, conversation });
    expect(parseChatTarget(`?project=${project}&conversation=${NEW_CONVERSATION}`)).toEqual({ projectId: project, conversation: NEW_CONVERSATION });
    expect(parseChatTarget(`?view=team&project=${project}`)).toEqual({ projectId: project, conversation: null });
  });

  it('opens nothing for a missing or malformed project id', () => {
    for (const search of ['', '?view=team', '?project=', '?project=abc', '?project=../admin', `?project=${project}x`]) {
      expect(parseChatTarget(search), search).toBeNull();
    }
  });

  it('falls back to the latest conversation for a malformed conversation id', () => {
    for (const value of ['', 'latest', '1', '<script>', `${conversation}/x`]) {
      expect(parseChatTarget(`?project=${project}&conversation=${encodeURIComponent(value)}`), value).toEqual({ projectId: project, conversation: null });
    }
  });

  it('writes the target beside the view and unrelated parameters', () => {
    expect(chatSearch({ projectId: project, conversation }, '?view=conversations&token=abc')).toBe(`?view=conversations&token=abc&project=${project}&conversation=${conversation}`);
    expect(chatSearch({ projectId: project, conversation: null }, `?project=${project}&conversation=${conversation}`)).toBe(`?project=${project}`);
  });

  it('removes both parameters when the chat closes', () => {
    expect(chatSearch(null, `?view=team&project=${project}&conversation=${conversation}`)).toBe('?view=team');
    expect(chatSearch(null, `?project=${project}`)).toBe('');
  });

  it('round-trips every kind of target', () => {
    for (const target of [{ projectId: project, conversation }, { projectId: project, conversation: NEW_CONVERSATION }, { projectId: project, conversation: null }]) {
      expect(parseChatTarget(chatSearch(target, '?view=usage'))).toEqual(target);
    }
  });
});
