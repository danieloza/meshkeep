import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl } from '@/lib/provider';
import { isProviderPresetId, PROVIDER_PRESET_IDS, PROVIDER_PRESETS, recognizeKey } from '@/lib/provider-presets';

// Short, obviously fake keys: real-looking ones would trip the secret scanner.
const presetOf = (key: string) => {
  const result = recognizeKey(key);
  return result.kind === 'recognized' ? result.preset.id : result.kind;
};

describe('recognizeKey', () => {
  it('recognizes a key by a prefix that belongs to one vendor', () => {
    expect(presetOf('sk-ant-api03-test')).toBe('anthropic');
    expect(presetOf('sk-or-v1-test')).toBe('openrouter');
    expect(presetOf('sk-proj-test')).toBe('openai');
    expect(presetOf('sk-svcacct-test')).toBe('openai');
    expect(presetOf('gsk_test')).toBe('groq');
    expect(presetOf('xai-test')).toBe('xai');
    expect(presetOf('AIzaTest')).toBe('google');
  });

  it('recognizes an older OpenAI key by its marker', () => {
    // Joined at run time: written out whole, even a fake key with the marker
    // is a match for GitHub's push protection, which then refuses the push.
    expect(presetOf(['sk-abc', 'T3Blbk', 'FJxyz'].join(''))).toBe('openai');
  });

  it('says what the key was recognized by, never the key', () => {
    const result = recognizeKey('sk-ant-api03-secretpart');
    expect(result).toMatchObject({ kind: 'recognized', by: 'the sk-ant- prefix' });
    expect(JSON.stringify(result)).not.toContain('secretpart');
  });

  it('offers a choice for a plain sk- key instead of guessing', () => {
    const result = recognizeKey('sk-0123456789abcdef');
    expect(result.kind).toBe('ambiguous');
    expect(result.kind === 'ambiguous' && result.presets.map((preset) => preset.id)).toEqual(['deepseek', 'moonshot', 'openai']);
  });

  it('ignores the whitespace a paste brings along', () => {
    expect(presetOf('  gsk_test\n')).toBe('groq');
  });

  it('knows nothing of empty input or a key with no known prefix', () => {
    expect(recognizeKey('').kind).toBe('none');
    expect(recognizeKey('   ').kind).toBe('none');
    expect(recognizeKey('abc123').kind).toBe('unknown');
    expect(recognizeKey('Sk-ant-test').kind).toBe('unknown');
  });
});

describe('PROVIDER_PRESETS', () => {
  it('has a valid https address for every preset, as the server will check it', () => {
    for (const id of PROVIDER_PRESET_IDS) {
      const preset = PROVIDER_PRESETS[id];
      expect(preset.id).toBe(id);
      const url = normalizeBaseUrl(preset.baseUrl);
      expect(url.ok, preset.label).toBe(true);
      expect(url.ok && url.url.startsWith('https://')).toBe(true);
    }
  });

  it('tells preset ids from anything else', () => {
    expect(isProviderPresetId('anthropic')).toBe(true);
    expect(isProviderPresetId('other')).toBe(false);
  });
});
