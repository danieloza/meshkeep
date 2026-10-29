import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError, fallbackMessage } from '@/lib/api-client';

// The client against a fake `fetch`: what it sends, and how it turns each
// kind of answer into a value or an error. The routes themselves are covered
// by the API tests on the built worker.

type Call = { url: string; init: RequestInit };

function fakeFetch(answer: () => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }));
  return calls;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requests', () => {
  it('reads without a cache and returns the parsed body', async () => {
    const calls = fakeFetch(() => json({ projects: [] }));
    expect(await api.projects.list()).toEqual({ projects: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/projects');
    expect(calls[0].init).toMatchObject({ method: 'GET', cache: 'no-store' });
    expect(calls[0].init.body).toBeUndefined();
  });

  it('sends a JSON body with its content type', async () => {
    const calls = fakeFetch(() => json({ instructions: 'x' }));
    await api.projects.updateInstructions('p-1', { instructions: 'x' });
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(calls[0].init.body).toBe('{"instructions":"x"}');
  });

  it('sends a form as it is, so the browser sets the multipart boundary', async () => {
    const calls = fakeFetch(() => json({ files: [] }, 201));
    const form = new FormData();
    form.append('paths', '[]');
    await api.projects.upload('p-1', form);
    expect(calls[0].init.body).toBe(form);
    expect(calls[0].init.headers).toBeUndefined();
  });

  it('encodes ids in the path and every value in the query', async () => {
    const calls = fakeFetch(() => json({}));
    await api.projects.files('a/b?c');
    await api.search('raport & żółw');
    await api.projects.conversation('p 1', 'c&d=1');
    expect(calls.map((call) => call.url)).toEqual([
      '/api/projects/a%2Fb%3Fc/files',
      '/api/search?q=raport+%26+%C5%BC%C3%B3%C5%82w',
      '/api/projects/p%201/conversations?conversationId=c%26d%3D1',
    ]);
  });
});

describe('errors', () => {
  it('carries the status and the server message', async () => {
    fakeFetch(() => json({ error: 'You do not have permission to edit this project.' }, 403));
    const error = await api.projects.remove('p-1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 403, message: 'You do not have permission to edit this project.' });
  });

  it('falls back to its own message when the body is not JSON or names no error', async () => {
    fakeFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api.usage()).rejects.toMatchObject({ status: 502, message: fallbackMessage(502) });

    fakeFetch(() => json({ error: '' }, 404));
    await expect(api.usage()).rejects.toMatchObject({ status: 404, message: fallbackMessage(404) });
  });

  it('lets a network failure through unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const error = await api.usage().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(ApiRequestError);
  });

  it('says what a status means when the server could not', () => {
    expect(fallbackMessage(401)).toMatch(/session/i);
    expect(fallbackMessage(413)).toMatch(/too large/i);
    expect(fallbackMessage(429)).toMatch(/too many/i);
    expect(fallbackMessage(503)).toMatch(/not responding/i);
    expect(fallbackMessage(404)).toBe('The request failed (404).');
  });
});

describe('chat', () => {
  const pytanie = { projectId: 'p-1', model: 'm', messages: [{ role: 'user' as const, content: 'Hej' }] };

  it('hands over the answer stream', async () => {
    fakeFetch(() => new Response('{"type":"delta","text":"Hej"}\n', { status: 200 }));
    const stream = await api.chat(pytanie);
    expect(await new Response(stream).text()).toBe('{"type":"delta","text":"Hej"}\n');
  });

  it('throws what the server said when it refuses before streaming', async () => {
    fakeFetch(() => json({ error: 'The daily token limit has been reached.' }, 429));
    await expect(api.chat(pytanie)).rejects.toMatchObject({ status: 429, message: 'The daily token limit has been reached.' });
  });

  it('treats a success without a body as no answer', async () => {
    fakeFetch(() => new Response(null, { status: 204 }));
    await expect(api.chat(pytanie)).rejects.toMatchObject({ message: 'The model did not respond.' });
  });
});
