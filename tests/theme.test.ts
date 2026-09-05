import { describe, expect, it } from 'vitest';
import { parseTheme, resolveTheme, THEME_STORAGE_KEY } from '@/lib/theme';

describe('parseTheme', () => {
  it('przyjmuje tylko dwie prawidłowe wartości', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
  });

  it('odrzuca śmieci z localStorage', () => {
    for (const value of [null, undefined, '', 'DARK', 'ciemny', '1', 0, {}, []]) {
      expect(parseTheme(value), String(value)).toBeNull();
    }
  });
});

describe('resolveTheme', () => {
  it('zapamiętany wybór ma pierwszeństwo przed systemem', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('bez zapamiętanego wyboru schodzi do preferencji systemu', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });

  // Regresja: wcześniej stan czytano z klasy `dark` ustawianej przez skrypt
  // inline, który produkcyjna CSP blokuje. Zapamiętane „dark” gubiło się przy
  // każdym odświeżeniu, bo klasy nie było, a nikt nie sięgał do localStorage.
  it('zapamiętane „dark” przetrwa, nawet gdy system woli jasny i nic nie ustawiło klasy', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('klucz w localStorage', () => {
  it('jest ten sam, którego używa skrypt w layout.tsx', () => {
    expect(THEME_STORAGE_KEY).toBe('meshkeep-theme');
  });
});
