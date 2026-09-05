import { describe, expect, it } from 'vitest';
import { limitsAreCoherent, MAX_DAILY_TOKENS, MAX_MONTHLY_TOKENS, parseLimitInput } from '@/lib/limits';

describe('parseLimitInput', () => {
  it('przyjmuje liczby całkowite, także z separatorami wpisanymi przez człowieka', () => {
    expect(parseLimitInput('400000', 'dailyTokens')).toBe(400_000);
    expect(parseLimitInput('400 000', 'dailyTokens')).toBe(400_000);
    expect(parseLimitInput('8_000_000', 'monthlyTokens')).toBe(8_000_000);
  });

  it('zero jest prawidłowe — to świadome odcięcie, nie brak wartości', () => {
    expect(parseLimitInput('0', 'dailyTokens')).toBe(0);
  });

  it('odrzuca wszystko, co nie jest liczbą', () => {
    for (const value of ['', '   ', 'dużo', '12.5', '-5', '1e6', '400000x', '٤٠٠']) {
      expect(parseLimitInput(value, 'dailyTokens'), value).toBeNull();
    }
  });

  it('pilnuje sufitu osobno dla limitu dziennego i miesięcznego', () => {
    expect(parseLimitInput(String(MAX_DAILY_TOKENS), 'dailyTokens')).toBe(MAX_DAILY_TOKENS);
    expect(parseLimitInput(String(MAX_DAILY_TOKENS + 1), 'dailyTokens')).toBeNull();
    expect(parseLimitInput(String(MAX_MONTHLY_TOKENS), 'monthlyTokens')).toBe(MAX_MONTHLY_TOKENS);
    expect(parseLimitInput(String(MAX_MONTHLY_TOKENS + 1), 'monthlyTokens')).toBeNull();
    // Wartość dozwolona miesięcznie bywa za duża jak na limit dzienny.
    expect(parseLimitInput('20000000', 'monthlyTokens')).toBe(20_000_000);
    expect(parseLimitInput('20000000', 'dailyTokens')).toBeNull();
  });
});

describe('limitsAreCoherent', () => {
  it('miesięczny niższy od dziennego nie ma sensu', () => {
    expect(limitsAreCoherent(400_000, 8_000_000)).toBe(true);
    expect(limitsAreCoherent(400_000, 400_000)).toBe(true);
    expect(limitsAreCoherent(400_000, 399_999)).toBe(false);
  });

  it('zerowe limity są spójne — nic nie wolno', () => {
    expect(limitsAreCoherent(0, 0)).toBe(true);
  });
});
