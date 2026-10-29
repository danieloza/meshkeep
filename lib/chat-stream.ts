// Shared by the chat route and the browser. Two wire formats meet here:
//
// - Providers stream OpenAI-style server-sent events: `data: {json}` lines,
//   closed by `data: [DONE]`.
// - MeshKeep streams newline-delimited JSON events to the browser. NDJSON
//   rather than SSE because the browser reads it with `fetch`, which already
//   carries the session cookie and the same-origin rules the rest of the API
//   relies on.

import type { ContextFile } from './contracts/conversations';

// Defined with the conversation contracts, because stored messages carry it
// too. Re-exported for the code that already imports it from here.
export type { ContextFile, ContextFileStatus } from './contracts/conversations';

export type ChatUsage = { inputTokens: number; outputTokens: number; estimated: boolean };

export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; conversationId: string; usage: ChatUsage; context: ContextFile[] }
  | { type: 'error'; error: string };

export type ProviderChunk = {
  delta?: string;
  usage?: { inputTokens: number; outputTokens: number };
  done?: boolean;
};

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
}

function readProviderEvent(data: string): ProviderChunk | null {
  if (data === '[DONE]') return { done: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    // A provider may interleave something that is not JSON. Dropping it is
    // safer than failing an answer that is otherwise arriving fine.
    return null;
  }
  const event = parsed as {
    choices?: Array<{ delta?: { content?: unknown } }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } | null;
  };
  const chunk: ProviderChunk = {};
  const content = event.choices?.[0]?.delta?.content;
  if (typeof content === 'string' && content) chunk.delta = content;
  const input = tokenCount(event.usage?.prompt_tokens);
  const output = tokenCount(event.usage?.completion_tokens);
  if (input !== null && output !== null) chunk.usage = { inputTokens: input, outputTokens: output };
  return chunk.delta || chunk.usage ? chunk : null;
}

// Network chunks do not respect line boundaries, so an event can arrive split
// across two reads. The parser keeps the unfinished tail until the rest comes.
export function createSseParser() {
  let buffer = '';
  return {
    push(text: string): ProviderChunk[] {
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      const chunks: ProviderChunk[] = [];
      for (const line of lines) {
        // Comments (`: keep-alive`) and other SSE fields carry no content.
        if (!line.startsWith('data:')) continue;
        const chunk = readProviderEvent(line.slice(5).trim());
        if (chunk) chunks.push(chunk);
      }
      return chunks;
    },
    flush(): ProviderChunk[] {
      const rest = buffer.trim();
      buffer = '';
      if (!rest.startsWith('data:')) return [];
      const chunk = readProviderEvent(rest.slice(5).trim());
      return chunk ? [chunk] : [];
    },
  };
}

export function createLineSplitter() {
  let buffer = '';
  return {
    push(text: string): string[] {
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      return lines.filter((line) => line.trim());
    },
    flush(): string[] {
      const rest = buffer.trim();
      buffer = '';
      return rest ? [rest] : [];
    },
  };
}

export function parseStreamEvent(line: string): ChatStreamEvent | null {
  try {
    const event = JSON.parse(line) as ChatStreamEvent;
    return event && typeof event === 'object' && 'type' in event ? event : null;
  } catch {
    return null;
  }
}

// Used only when a provider streams without reporting usage. Roughly four
// characters per token, rounded up, so limits are charged rather than skipped.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function readContextFiles(raw: string | null | undefined): ContextFile[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ContextFile =>
      typeof item === 'object' && item !== null
      && typeof (item as ContextFile).id === 'string'
      && typeof (item as ContextFile).path === 'string'
      && ['included', 'truncated', 'unreadable', 'skipped'].includes((item as ContextFile).status));
  } catch {
    return [];
  }
}
