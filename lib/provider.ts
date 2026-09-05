// Rules for connecting an arbitrary model provider.
//
// Nearly every provider speaks the OpenAI shape — POST {base}/chat/completions
// with a Bearer key, answering with choices[0].message.content and a usage
// block — so one adapter covers OpenAI, OpenRouter, Groq, Together, Mistral,
// DeepSeek, Fireworks, TokenRouter and a local Ollama or LM Studio. What
// differs between them is only the base URL, the key and the model list.
//
// This module holds the parts that are pure decisions rather than I/O, so the
// rules that matter for safety can be tested without a worker, the same way
// the file guards and the audit barrier are.

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

// Hosts that must never be reachable from a user-supplied base URL. Letting
// someone choose where the server sends a request is server-side request
// forgery: the obvious prize is a cloud metadata endpoint, and the subtler one
// is any listener that simply records the Authorization header it receives.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const PRIVATE_SUFFIX = ['.local', '.internal', '.localdomain', '.home.arpa'];

function isPrivateAddress(host: string): boolean {
  if (LOOPBACK.has(host)) return false; // handled separately, and allowed over http
  if (PRIVATE_SUFFIX.some((suffix) => host.endsWith(suffix))) return true;
  // Bare IPv6 or any IPv4 literal. A public API is reached by name; an address
  // typed here is far more likely to be an attempt to reach something internal
  // than a legitimate provider.
  if (host.includes(':')) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

export function normalizeBaseUrl(raw: string): UrlCheck {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'Enter the provider base URL.' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'That is not a valid URL. It should look like https://api.example.com/v1' };
  }

  if (url.username || url.password) {
    return { ok: false, reason: 'Remove the credentials from the URL. The key belongs in the key field.' };
  }

  const host = url.hostname.toLowerCase();
  const loopback = LOOPBACK.has(host);

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    return {
      ok: false,
      reason: url.protocol === 'http:'
        // Plain http would put the key on the wire in clear text at every hop.
        ? 'Use https. Plain http is only allowed for a provider running on this machine.'
        : 'Only http and https are supported.',
    };
  }
  if (isPrivateAddress(host)) {
    return { ok: false, reason: 'That address points inside a private network, which is not allowed.' };
  }

  // Accept a URL pasted straight from documentation, which often includes the
  // endpoint rather than just the base.
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/chat\/completions$/, '');
  return { ok: true, url: `${url.origin}${path}` };
}

// Shown in place of the key so somebody can tell which key is configured
// without the value ever leaving the server.
export function maskKey(key: string): string {
  const clean = key.trim();
  if (clean.length <= 8) return '••••';
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

export type ProviderModel = { id: string; label: string };

const MAX_MODELS = 200;

// Providers disagree about the envelope: OpenAI answers { data: [...] }, some
// answer { models: [...] }, a few answer a bare array. Entries are sometimes
// objects and sometimes plain strings. Accept all of it rather than making the
// user care.
export function readModelList(payload: unknown): ProviderModel[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray((payload as { models?: unknown })?.models)
        ? (payload as { models: unknown[] }).models
        : [];

  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  for (const entry of list) {
    const id = typeof entry === 'string'
      ? entry
      : typeof (entry as { id?: unknown })?.id === 'string'
        ? (entry as { id: string }).id
        : typeof (entry as { name?: unknown })?.name === 'string'
          ? (entry as { name: string }).name
          : '';
    const clean = id.trim().slice(0, 200);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    const named = typeof (entry as { name?: unknown })?.name === 'string' ? (entry as { name: string }).name.trim() : '';
    models.push({ id: clean, label: (named && named !== clean ? named : clean).slice(0, 120) });
    if (models.length >= MAX_MODELS) break;
  }
  return models.sort((a, b) => a.id.localeCompare(b.id, 'en'));
}
