import { describe, expect, it } from 'vitest';
import { autoAttachments, parseContextMode } from '@/lib/context-mode';

describe('parseContextMode', () => {
  it('accepts only the two modes', () => {
    expect(parseContextMode('auto')).toBe('auto');
    expect(parseContextMode('manual')).toBe('manual');
    for (const value of [null, undefined, '', 'Auto', 'bypass', 1, {}]) {
      expect(parseContextMode(value), JSON.stringify(value) ?? 'undefined').toBeNull();
    }
  });
});

describe('autoAttachments', () => {
  it('adds the suggested files that are not picked yet, in order', () => {
    expect(autoAttachments(['a', 'b', 'c'], ['b'], [], 8)).toEqual(['a', 'c']);
  });

  it('leaves out the files the member removed', () => {
    expect(autoAttachments(['a', 'b', 'c'], [], ['a'], 8)).toEqual(['b', 'c']);
  });

  it('never goes over the limit of files per message', () => {
    expect(autoAttachments(['a', 'b', 'c'], ['x', 'y'], [], 3)).toEqual(['a']);
    expect(autoAttachments(['a'], ['x', 'y', 'z'], [], 3)).toEqual([]);
  });
});
