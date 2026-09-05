import 'server-only';

import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { providers } from '@/db/schema';
import { maskKey, normalizeBaseUrl, readModelList, type ProviderModel } from '@/lib/provider';
import { decryptProviderKey, encryptProviderKey, providerKeyEncryptionConfigured } from '@/lib/provider-crypto';
import type { CurrentMember } from './auth';
import { ApiError } from './http';

// The row that holds the owner's default. Member ids are UUIDs, so this
// literal cannot collide with one.
export const TEAM_SCOPE = 'team';

// Used when nothing is configured in the database. This keeps a deployment
// that was set up with an environment variable working exactly as before,
// so adding provider configuration does not break an existing install.
const FALLBACK_BASE_URL = 'https://api.tokenrouter.com/v1';
const FALLBACK_MODELS: ProviderModel[] = [{ id: 'z-ai/glm-5.3-free', label: 'GLM 5.3 Free' }];

function encryptionSecret(): string {
  const secret = env.PROVIDER_KEY_ENCRYPTION_KEY;
  if (!providerKeyEncryptionConfigured(secret)) {
    throw new ApiError(503, 'Provider key encryption is not configured on this deployment.');
  }
  return secret!;
}

export function assertProviderKeyEncryptionConfigured() {
  encryptionSecret();
}

export type ResolvedProvider = {
  // Where the configuration came from, so the interface can say whose key is
  // paying for a request.
  origin: 'member' | 'team' | 'environment';
  label: string;
  baseUrl: string;
  apiKey: string;
  models: ProviderModel[];
};

function parseModels(raw: string): ProviderModel[] {
  try {
    return readModelList(JSON.parse(raw));
  } catch {
    return [];
  }
}

// A member's own configuration wins over the team default, which in turn wins
// over the environment. Returning null means nothing is configured anywhere,
// which the caller reports as a missing provider rather than an error.
export async function resolveProvider(member: CurrentMember): Promise<ResolvedProvider | null> {
  const db = getDb();
  const rows = await db.select().from(providers);
  const own = rows.find((row) => row.scope === member.id);
  const team = rows.find((row) => row.scope === TEAM_SCOPE);
  const chosen = own ?? team;

  if (chosen) {
    return {
      origin: own ? 'member' : 'team',
      label: chosen.label,
      baseUrl: chosen.baseUrl,
      apiKey: await decryptProviderKey(chosen.apiKeyCiphertext, encryptionSecret()),
      models: parseModels(chosen.models),
    };
  }

  const apiKey = env.TOKENROUTER_API_KEY;
  if (!apiKey) return null;
  return { origin: 'environment', label: 'TokenRouter', baseUrl: FALLBACK_BASE_URL, apiKey, models: FALLBACK_MODELS };
}

async function providerFetch(baseUrl: string, path: string, apiKey: string, init: RequestInit = {}) {
  // Build a Headers object rather than spreading: HeadersInit may be an array
  // or a Headers instance, and spreading either into an object literal yields
  // nonsense instead of headers.
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${apiKey}`);
  headers.set('Accept', 'application/json');
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(45_000),
    // Never follow a redirect: the key is in a header, and following would
    // hand it to whatever host the response points at. workerd does not
    // implement 'error', and 'manual' gives the same guarantee because the 3xx
    // then fails the response.ok check below.
    redirect: 'manual',
  });
}

// Asks the provider what it offers. Most speak the OpenAI shape; the ones that
// do not simply return nothing useful, and the caller falls back to letting the
// user name a model by hand.
export async function fetchProviderModels(baseUrl: string, apiKey: string): Promise<ProviderModel[]> {
  try {
    const response = await providerFetch(baseUrl, '/models', apiKey);
    if (!response.ok) return [];
    return readModelList(await response.json());
  } catch {
    return [];
  }
}

// Verifies a configuration before it is stored, so a wrong key is reported
// while somebody is looking at the form rather than at their first message.
export async function checkProvider(baseUrl: string, apiKey: string): Promise<{ ok: boolean; reason?: string; models: ProviderModel[] }> {
  let response: Response;
  try {
    response = await providerFetch(baseUrl, '/models', apiKey);
  } catch {
    return { ok: false, reason: 'The provider could not be reached at that address.', models: [] };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: 'The provider rejected this key.', models: [] };
  }
  if (response.status === 404) {
    // Not every provider exposes a model list. That is not a failure; it only
    // means the list has to be typed in.
    return { ok: true, models: [] };
  }
  if (!response.ok) {
    return { ok: false, reason: `The provider answered HTTP ${response.status}.`, models: [] };
  }
  try {
    return { ok: true, models: readModelList(await response.json()) };
  } catch {
    return { ok: true, models: [] };
  }
}

export async function callProvider(provider: ResolvedProvider, input: {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens: number;
}) {
  const response = await providerFetch(provider.baseUrl, '/chat/completions', provider.apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: input.model, messages: input.messages, temperature: input.temperature, max_tokens: input.maxTokens, stream: false }),
  });

  if (!response.ok) {
    // The label and status are safe to log; the key never is.
    console.error('Provider request failed', { provider: provider.label, status: response.status, model: input.model });
    if (response.status === 401 || response.status === 403) throw new ApiError(502, `${provider.label} rejected the key or access to the selected model.`);
    if (response.status === 404) throw new ApiError(502, `${provider.label} does not currently offer the selected model.`);
    if (response.status === 429) throw new ApiError(429, `${provider.label} rate-limited the request. Try again later.`);
    throw new ApiError(502, `${provider.label} could not complete the request (HTTP ${response.status}).`);
  }

  const result = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new ApiError(502, 'The provider returned an invalid response.');
  const inputTokens = typeof result.usage?.prompt_tokens === 'number' ? Math.max(0, Math.trunc(result.usage.prompt_tokens)) : 0;
  const outputTokens = typeof result.usage?.completion_tokens === 'number' ? Math.max(0, Math.trunc(result.usage.completion_tokens)) : 0;
  return { content: content.slice(0, 200_000), inputTokens, outputTokens };
}

// Re-exported so callers do not need to know where the validation lives.
export { normalizeBaseUrl };
export type { ProviderModel };

export async function saveProvider(scope: string, input: { label: string; baseUrl: string; apiKey: string; models: ProviderModel[] }) {
  const now = new Date();
  const apiKeyCiphertext = await encryptProviderKey(input.apiKey, encryptionSecret());
  await getDb().insert(providers).values({
    scope,
    label: input.label,
    baseUrl: input.baseUrl,
    apiKeyCiphertext,
    keyPreview: maskKey(input.apiKey),
    models: JSON.stringify(input.models),
    modelsFetchedAt: now,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: providers.scope,
    set: { label: input.label, baseUrl: input.baseUrl, apiKeyCiphertext, keyPreview: maskKey(input.apiKey), models: JSON.stringify(input.models), modelsFetchedAt: now, updatedAt: now },
  });
}

export async function removeProvider(scope: string) {
  await getDb().delete(providers).where(eq(providers.scope, scope));
}
