import { describe, expect, it } from 'vitest';
import { formatBytes, initials } from '@/lib/format';

describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Alex Morgan')).toBe('AM');
    expect(initials('ana maria silva')).toBe('AM');
  });

  it('handles one word, extra spaces and an empty name', () => {
    expect(initials('Owner')).toBe('O');
    expect(initials('  Tomek   Nowak ')).toBe('TN');
    expect(initials('')).toBe('');
  });

  it('keeps a letter outside the BMP whole', () => {
    expect(initials('𝒜da Lovelace')).toBe('𝒜L');
  });
});

describe('formatBytes', () => {
  it('uses a decimal point, like the rest of the English interface', () => {
    expect(formatBytes(2_202_009)).toBe('2.1 MB');
    expect(formatBytes(6144)).toBe('6 KB');
  });
});
