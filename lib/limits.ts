// Górne granice limitów, jakie owner może ustawić członkowi. Są tu, a nie
// w route handlerze, żeby ta sama reguła obowiązywała walidację po stronie
// serwera i podpowiedzi w panelu — i żeby dała się przetestować.

export const MAX_DAILY_TOKENS = 10_000_000;
export const MAX_MONTHLY_TOKENS = 300_000_000;

export const DEFAULT_DAILY_TOKENS = 400_000;
export const DEFAULT_MONTHLY_TOKENS = 8_000_000;

export type LimitField = 'dailyTokens' | 'monthlyTokens';

const CEILINGS: Record<LimitField, number> = {
  dailyTokens: MAX_DAILY_TOKENS,
  monthlyTokens: MAX_MONTHLY_TOKENS,
};

// Zwraca liczbę gotową do wysłania albo null, gdy wpis jest nie do uratowania.
// Puste pole i śmieci traktujemy inaczej niż zero: zero to świadome „nic nie
// wolno", a niepoprawny tekst nie może po cichu zamienić się w limit.
export function parseLimitInput(value: string, field: LimitField): number | null {
  const normalized = value.replace(/[\s_]/g, '');
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed > CEILINGS[field]) return null;
  return parsed;
}

// Monthly limit niższy od dziennego nie ma sensu — dzienny nigdy by się nie
// wyczerpał, bo miesięczny odciąłby wcześniej.
export function limitsAreCoherent(dailyTokens: number, monthlyTokens: number): boolean {
  return monthlyTokens >= dailyTokens;
}
