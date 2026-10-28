import { describe, expect, it } from 'vitest';
import { createLineSplitter, createSseParser, estimateTokens, parseStreamEvent, readContextFiles } from '@/lib/chat-stream';

const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

describe('provider SSE parser', () => {
  it('reads content deltas, the usage chunk and the end marker', () => {
    const parser = createSseParser();
    const usage = `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 5 } })}\n\n`;
    expect(parser.push(`${delta('Hel')}${delta('lo')}${usage}data: [DONE]\n\n`)).toEqual([
      { delta: 'Hel' },
      { delta: 'lo' },
      { usage: { inputTokens: 12, outputTokens: 5 } },
      { done: true },
    ]);
  });

  it('keeps an event that arrives split across network chunks', () => {
    // Reads do not respect line boundaries; dropping the half line would cut
    // words out of the answer.
    const parser = createSseParser();
    const event = delta('complete word');
    expect(parser.push(event.slice(0, 20))).toEqual([]);
    expect(parser.push(event.slice(20))).toEqual([{ delta: 'complete word' }]);
  });

  it('ignores comments, other fields, empty deltas and malformed JSON', () => {
    const parser = createSseParser();
    const noise = `: keep-alive\nevent: ping\ndata: {not json\n\ndata: ${JSON.stringify({ choices: [{ delta: { role: 'assistant' } }] })}\n\n`;
    expect(parser.push(`${noise}${delta('ok')}`)).toEqual([{ delta: 'ok' }]);
  });

  it('accepts CRLF line endings and a final event without a trailing newline', () => {
    const parser = createSseParser();
    expect(parser.push(delta('a').replaceAll('\n', '\r\n'))).toEqual([{ delta: 'a' }]);
    expect(parser.push('data: [DONE]')).toEqual([]);
    expect(parser.flush()).toEqual([{ done: true }]);
  });
});

describe('NDJSON events to the browser', () => {
  it('splits lines across chunks and skips blank ones', () => {
    const lines = createLineSplitter();
    expect(lines.push('{"type":"delta","text":"a"}\n{"type":"del')).toEqual(['{"type":"delta","text":"a"}']);
    expect(lines.push('ta","text":"b"}\n\n')).toEqual(['{"type":"delta","text":"b"}']);
    expect(lines.push('{"type":"error","error":"x"}')).toEqual([]);
    expect(lines.flush()).toEqual(['{"type":"error","error":"x"}']);
  });

  it('rejects lines that are not events', () => {
    expect(parseStreamEvent('{"type":"delta","text":"a"}')).toEqual({ type: 'delta', text: 'a' });
    expect(parseStreamEvent('not json')).toBeNull();
    expect(parseStreamEvent('{"text":"no type"}')).toBeNull();
  });
});

describe('usage estimate and stored context', () => {
  it('rounds the token estimate up, so a limit is never undercharged', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('reads only well-formed context entries back from the database', () => {
    const stored = JSON.stringify([
      { id: 'f1', path: 'docs/a.md', status: 'included' },
      { id: 'f2', path: 'docs/b.pdf', status: 'truncated', note: 'Only the beginning fit.' },
      { id: 'f3', path: 'x', status: 'unknown' },
      'garbage',
    ]);
    expect(readContextFiles(stored)).toEqual([
      { id: 'f1', path: 'docs/a.md', status: 'included' },
      { id: 'f2', path: 'docs/b.pdf', status: 'truncated', note: 'Only the beginning fit.' },
    ]);
    expect(readContextFiles(null)).toEqual([]);
    expect(readContextFiles('{oops')).toEqual([]);
  });
});
