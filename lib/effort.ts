// How hard a reasoning model thinks before it answers, sent as
// `reasoning_effort`. Kept apart from the zod contracts so the browser can use
// it without loading zod.
export const EFFORT_LEVELS = ['low', 'medium', 'high'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const EFFORT_LABELS: Record<EffortLevel, string> = { low: 'Low effort', medium: 'Medium effort', high: 'High effort' };

export const EFFORT_STORAGE_KEY = 'meshkeep-effort';

export function parseEffort(value: unknown): EffortLevel | null {
  return EFFORT_LEVELS.find((level) => level === value) ?? null;
}
