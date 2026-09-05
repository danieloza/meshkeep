// Pure theme-selection logic that remains testable without a browser.

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'meshkeep-theme';

export function parseTheme(value: unknown): Theme | null {
  return value === 'dark' || value === 'light' ? value : null;
}

// A saved choice wins; the system preference is only the default.
export function resolveTheme(stored: Theme | null, prefersDark: boolean): Theme {
  return stored ?? (prefersDark ? 'dark' : 'light');
}
