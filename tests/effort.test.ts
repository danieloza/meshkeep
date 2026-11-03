import { describe, expect, it } from 'vitest';
import { effortLevel } from '@/lib/contracts/providers';
import { EFFORT_LEVELS, parseEffort } from '@/lib/effort';

describe('parseEffort', () => {
  it('accepts the three levels and nothing else', () => {
    for (const level of EFFORT_LEVELS) expect(parseEffort(level)).toBe(level);
    for (const value of [null, undefined, '', 'High', 'max', 'minimal', 2, {}]) {
      expect(parseEffort(value), JSON.stringify(value) ?? 'undefined').toBeNull();
    }
  });

  it('matches what the chat request accepts', () => {
    expect(effortLevel.options).toEqual([...EFFORT_LEVELS]);
  });
});
