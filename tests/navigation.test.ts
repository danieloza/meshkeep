import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SECTION,
  isOwnerOnlySection,
  parseSection,
  SECTION_LABELS,
  SECTIONS,
  sectionSearch,
  visibleSections,
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
  it('restricts the activity log to the owner', () => {
    expect(isOwnerOnlySection('activity')).toBe(true);
    expect(visibleSections(true)).toContain('activity');
    expect(visibleSections(false)).not.toContain('activity');
  });

  it('shows all other views to every member', () => {
    for (const section of ['dashboard', 'projects', 'conversations', 'team', 'usage'] as const) {
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
