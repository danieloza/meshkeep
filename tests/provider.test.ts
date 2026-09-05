import { describe, expect, it } from 'vitest';
import { maskKey, normalizeBaseUrl, readModelList } from '@/lib/provider';

describe('provider base URL rules', () => {
  it('accepts an ordinary provider endpoint', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1')).toEqual({ ok: true, url: 'https://api.openai.com/v1' });
    expect(normalizeBaseUrl('https://openrouter.ai/api/v1/')).toEqual({ ok: true, url: 'https://openrouter.ai/api/v1' });
  });

  it('accepts a URL pasted straight from documentation', () => {
    // People copy the full endpoint far more often than the base.
    const result = normalizeBaseUrl('https://api.groq.com/openai/v1/chat/completions');
    expect(result).toEqual({ ok: true, url: 'https://api.groq.com/openai/v1' });
  });

  it('refuses plain http anywhere but this machine', () => {
    // The key travels in a header; http would expose it at every hop.
    expect(normalizeBaseUrl('http://api.example.com/v1').ok).toBe(false);
    expect(normalizeBaseUrl('http://localhost:11434/v1')).toEqual({ ok: true, url: 'http://localhost:11434/v1' });
    expect(normalizeBaseUrl('http://127.0.0.1:1234/v1').ok).toBe(true);
  });

  it('refuses addresses inside a private network', () => {
    // Choosing where the server sends a request is server-side request forgery.
    // The classic target is a cloud metadata endpoint; any listener that simply
    // records the Authorization header works just as well for the attacker.
    for (const url of [
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5/v1',
      'https://192.168.1.10/v1',
      'https://172.16.4.4/v1',
      'https://printer.local/v1',
      'https://vault.internal/v1',
    ]) {
      expect(normalizeBaseUrl(url).ok, url).toBe(false);
    }
  });

  it('refuses credentials smuggled into the URL', () => {
    expect(normalizeBaseUrl('https://user:secret@api.example.com/v1').ok).toBe(false);
  });

  it('refuses anything that is not http or https', () => {
    for (const url of ['ftp://api.example.com', 'file:///etc/passwd', 'javascript:alert(1)']) {
      expect(normalizeBaseUrl(url).ok, url).toBe(false);
    }
  });

  it('explains the refusal instead of just saying no', () => {
    const result = normalizeBaseUrl('http://api.example.com/v1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/https/i);
  });
});

describe('key masking', () => {
  it('shows enough to recognise a key and not enough to use it', () => {
    const masked = maskKey('provider-abcdefghijklmnopqrstuvwxyz0123');
    expect(masked).toBe('prov••••0123');
    expect(masked).not.toContain('efghij');
  });

  it('reveals nothing at all from a short key', () => {
    expect(maskKey('sk-123')).toBe('••••');
  });
});

describe('model list — providers disagree about the envelope', () => {
  it('reads the OpenAI shape', () => {
    const models = readModelList({ data: [{ id: 'gpt-5' }, { id: 'gpt-4o' }] });
    expect(models.map((m) => m.id)).toEqual(['gpt-4o', 'gpt-5']);
  });

  it('reads a bare array and a models key', () => {
    expect(readModelList(['a', 'b']).map((m) => m.id)).toEqual(['a', 'b']);
    expect(readModelList({ models: [{ id: 'c' }] }).map((m) => m.id)).toEqual(['c']);
  });

  it('prefers a human name when the provider gives one', () => {
    const [model] = readModelList({ data: [{ id: 'meta/llama-4', name: 'Llama 4' }] });
    expect(model).toEqual({ id: 'meta/llama-4', label: 'Llama 4' });
  });

  it('drops duplicates and empty entries instead of passing them on', () => {
    const models = readModelList({ data: [{ id: 'a' }, { id: 'a' }, { id: '  ' }, {}, null] });
    expect(models.map((m) => m.id)).toEqual(['a']);
  });

  it('survives a response that is not a list at all', () => {
    for (const payload of [null, undefined, 'nope', { error: 'unauthorized' }]) {
      expect(readModelList(payload)).toEqual([]);
    }
  });
});
