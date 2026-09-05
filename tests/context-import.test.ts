import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeContextFile } from '@/lib/server/context-import';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/sample-context.json', import.meta.url)), 'utf8'),
) as unknown;

describe('normalizeContextFile', () => {
  it('czyta fixture w formacie eksportu Claude', () => {
    const conversations = normalizeContextFile(fixture);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].title).toBe('Przykładowa rozmowa');
    expect(conversations[0].messages).toEqual([
      { role: 'user', content: 'Przygotuj krótką listę zadań.' },
      { role: 'assistant', content: 'Oczywiście — zacznijmy od celu i zakresu.' },
    ]);
  });

  it('czyta własny format eksportu meshkeep-context', () => {
    const conversations = normalizeContextFile({
      format: 'meshkeep-context',
      version: 1,
      conversations: [
        { title: 'Runda pierwsza', messages: [{ role: 'user', content: 'Cześć' }, { role: 'assistant', content: 'Hej' }] },
      ],
    });
    expect(conversations).toHaveLength(1);
    expect(conversations[0].messages).toHaveLength(2);
  });

  it('czyta mapping w stylu eksportu ChatGPT i porządkuje po czasie', () => {
    const conversations = normalizeContextFile({
      conversations: [
        {
          title: 'Z mappingu',
          mapping: {
            b: { message: { author: { role: 'assistant' }, create_time: 200, content: { parts: ['Druga'] } } },
            a: { message: { author: { role: 'user' }, create_time: 100, content: { parts: ['Pierwsza'] } } },
          },
        },
      ],
    });
    expect(conversations[0].messages.map((message) => message.content)).toEqual(['Pierwsza', 'Druga']);
  });

  it('mapuje warianty nazw ról', () => {
    const conversations = normalizeContextFile({
      conversations: [
        {
          title: 'Role',
          messages: [
            { sender: 'human', text: 'A' },
            { sender: 'model', text: 'B' },
            { role: 'system', content: 'C' },
          ],
        },
      ],
    });
    expect(conversations[0].messages.map((message) => message.role)).toEqual(['user', 'assistant', 'system']);
  });

  it('pomija wpisy bez rozpoznanej roli albo bez treści', () => {
    const conversations = normalizeContextFile({
      conversations: [
        {
          title: 'Śmieci',
          messages: [
            { role: 'user', content: 'Zostaje' },
            { role: 'narrator', content: 'Nieznana rola' },
            { role: 'user', content: '   ' },
            null,
          ],
        },
      ],
    });
    expect(conversations[0].messages).toEqual([{ role: 'user', content: 'Zostaje' }]);
  });

  it('odrzuca plik bez obsługiwanych rozmów', () => {
    expect(() => normalizeContextFile({ cokolwiek: true })).toThrow();
    expect(() => normalizeContextFile([])).toThrow();
    expect(() => normalizeContextFile(null)).toThrow();
  });

  it('przycina bardzo długie rozmowy i treści', () => {
    const conversations = normalizeContextFile({
      conversations: [
        {
          title: 'x'.repeat(500),
          messages: Array.from({ length: 600 }, (_, index) => ({ role: 'user', content: `wiadomość ${index}` })),
        },
      ],
    });
    expect(conversations[0].title.length).toBeLessThanOrEqual(100);
    expect(conversations[0].messages).toHaveLength(500);
  });
});
