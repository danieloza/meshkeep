import 'server-only';

import { env } from 'cloudflare:workers';
import { and, asc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { providers, usageEvents } from '@/db/schema';
import type { CheckStatus, EffortLevel, ProviderConnection } from '@/lib/contracts/providers';
import { maskKey, normalizeBaseUrl, readModelList, type ProviderModel } from '@/lib/provider';
import { decryptProviderKey, encryptProviderKey, providerKeyEncryptionConfigured } from '@/lib/provider-crypto';
import type { CurrentMember } from './auth';
import { ApiError } from './http';

// The scope of a connection the owner sets up for everyone. Member ids are
// UUIDs, so this literal cannot collide with one.
export const TEAM_SCOPE = 'team';

// Per member, and for the team.
export const MAX_CONNECTIONS = 8;

// A connection with more models than this starts with none offered in the
// chat: a picker with hundreds of entries is no use, so its owner chooses.
export const CHOOSE_CHAT_MODELS_ABOVE = 30;

export type ProviderRow = typeof providers.$inferSelect;

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
  // The connection's id; null for the key set on the server.
  id: string | null;
  // Where the connection came from, so the interface can say whose key is
  // paying for a request.
  origin: 'member' | 'team' | 'environment';
  label: string;
  baseUrl: string;
  apiKey: string;
  models: ProviderModel[];
  // Models marked as accepting `reasoning_effort`; always a subset of `models`.
  effortModels: string[];
};

function parseModels(raw: string): ProviderModel[] {
  try {
    return readModelList(JSON.parse(raw));
  } catch {
    return [];
  }
}

// The ids in a JSON list that the provider still offers. A refreshed model
// list can drop a model, and a mark on it then stops counting without a
// separate cleanup.
function offeredIds(row: { models: string }, raw: string): string[] {
  const offered = new Set(parseModels(row.models).map((model) => model.id));
  try {
    const listed: unknown = JSON.parse(raw);
    return Array.isArray(listed) ? listed.filter((id): id is string => typeof id === 'string' && offered.has(id)) : [];
  } catch {
    return [];
  }
}

export function effortModelsOf(row: { models: string; effortModels: string }): string[] {
  return offeredIds(row, row.effortModels);
}

// The ids chosen for the chat, or null when the chat offers every model.
export function chatModelIdsOf(row: { models: string; chatModels: string | null }): string[] | null {
  return row.chatModels === null ? null : offeredIds(row, row.chatModels);
}

// What the chat offers from this connection.
export function chatModelsOf(row: { models: string; chatModels: string | null }): ProviderModel[] {
  const all = parseModels(row.models);
  const chosen = chatModelIdsOf(row);
  return chosen === null ? all : all.filter((model) => chosen.includes(model.id));
}

// The connections a member can use: their own, then the team's, each in the
// order they were added.
export async function usableConnections(member: CurrentMember): Promise<ProviderRow[]> {
  const rows = await getDb()
    .select()
    .from(providers)
    .where(or(eq(providers.scope, member.id), eq(providers.scope, TEAM_SCOPE)))
    .orderBy(asc(providers.createdAt));
  return [...rows.filter((row) => row.scope === member.id), ...rows.filter((row) => row.scope === TEAM_SCOPE)];
}

function originOf(row: ProviderRow, member: CurrentMember): 'member' | 'team' {
  return row.scope === member.id ? 'member' : 'team';
}

// The stored key, decrypted. Only ever passed on to the provider.
export async function storedKey(row: ProviderRow): Promise<string> {
  return decryptProviderKey(row.apiKeyCiphertext, encryptionSecret());
}

async function resolved(row: ProviderRow, member: CurrentMember): Promise<ResolvedProvider> {
  return {
    id: row.id,
    origin: originOf(row, member),
    label: row.label,
    baseUrl: row.baseUrl,
    apiKey: await storedKey(row),
    models: parseModels(row.models),
    effortModels: effortModelsOf(row),
  };
}

function fallbackProvider(): ResolvedProvider | null {
  const apiKey = env.TOKENROUTER_API_KEY;
  if (!apiKey) return null;
  // The environment fallback has no row to keep marks in, so it offers no Effort.
  return { id: null, origin: 'environment', label: 'TokenRouter', baseUrl: FALLBACK_BASE_URL, apiKey, models: FALLBACK_MODELS, effortModels: [] };
}

// Which connection answers a message. A named connection has to be the
// member's own or the team's. Without a name, the first connection whose chat
// offers the model answers, the member's own before the team's, and then
// simply the first one. With no connection at all, the key set on the server
// answers. Null means nothing is configured anywhere, which the caller reports
// as a missing provider rather than an error.
export async function resolveProvider(member: CurrentMember, request: { connectionId?: string; model?: string } = {}): Promise<ResolvedProvider | null> {
  const rows = await usableConnections(member);
  if (request.connectionId) {
    const row = rows.find((candidate) => candidate.id === request.connectionId);
    if (!row) throw new ApiError(404, 'That model connection was not found.');
    return resolved(row, member);
  }
  const offering = request.model ? rows.find((row) => chatModelsOf(row).some((model) => model.id === request.model)) : undefined;
  const chosen = offering ?? rows[0];
  return chosen ? resolved(chosen, member) : fallbackProvider();
}

// The models the chat offers a member, with the connection each one goes
// through: their own connections first, then the team's.
export async function availableModels(member: CurrentMember): Promise<ProviderModel[]> {
  const rows = await usableConnections(member);
  if (!rows.length) return fallbackProvider()?.models ?? [];
  return rows.flatMap((row) => {
    const effort = new Set(effortModelsOf(row));
    return chatModelsOf(row).map((model) => ({ ...model, effort: effort.has(model.id), connectionId: row.id, connectionLabel: row.label }));
  });
}

// The default for a message that names no connection, described for the
// interface: whose key pays and how much it offers.
export async function effectiveProvider(member: CurrentMember) {
  const rows = await usableConnections(member);
  if (rows[0]) return { label: rows[0].label, origin: originOf(rows[0], member), modelCount: chatModelsOf(rows[0]).length };
  const fallback = fallbackProvider();
  return fallback ? { label: fallback.label, origin: fallback.origin, modelCount: fallback.models.length } : null;
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
    // A streamed answer can legitimately run longer than any fixed timeout, so
    // a streaming caller passes its own signal and guards idle time itself.
    signal: init.signal ?? AbortSignal.timeout(45_000),
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

export type ProviderCheck = { ok: true; status: 'ok'; models: ProviderModel[] } | { ok: false; status: Exclude<CheckStatus, 'ok'>; reason: string };

const REJECTED = 'The provider rejected this key.';

// OpenRouter lists its models without looking at the key, so a wrong key
// passed the model-list check. Its key endpoint does look: 200 for a valid
// key, 401 otherwise (https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key).
function keyCheckPath(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname === 'openrouter.ai' ? '/key' : null;
  } catch {
    return null;
  }
}

// Verifies a connection before it is stored, so a wrong key is reported while
// somebody is looking at the form rather than at their first message.
export async function checkProvider(baseUrl: string, apiKey: string): Promise<ProviderCheck> {
  let response: Response;
  try {
    response = await providerFetch(baseUrl, '/models', apiKey);
  } catch {
    return { ok: false, status: 'unreachable', reason: 'The provider could not be reached at that address.' };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, status: 'rejected', reason: REJECTED };
  let models: ProviderModel[] = [];
  if (response.status === 404) {
    // Not every provider exposes a model list. That is not a failure; it only
    // means the model has to be named by hand.
  } else if (!response.ok) {
    return { ok: false, status: 'failed', reason: `The provider answered HTTP ${response.status}.` };
  } else {
    try { models = readModelList(await response.json()); } catch { models = []; }
  }

  const keyPath = keyCheckPath(baseUrl);
  if (keyPath) {
    let keyResponse: Response;
    try {
      keyResponse = await providerFetch(baseUrl, keyPath, apiKey);
    } catch {
      return { ok: false, status: 'unreachable', reason: 'The provider could not be reached to check the key.' };
    }
    if (keyResponse.status === 401 || keyResponse.status === 403) return { ok: false, status: 'rejected', reason: REJECTED };
    if (!keyResponse.ok) return { ok: false, status: 'failed', reason: `The provider answered HTTP ${keyResponse.status} when the key was checked.` };
  }
  return { ok: true, status: 'ok', models };
}

const FIRST_BYTE_TIMEOUT_MS = 45_000;

// The provider refused the key or the model during a chat. A class of its own,
// so the chat can mark the connection for the settings to show.
export class KeyRejectedError extends ApiError {
  constructor(label: string) {
    super(502, `${label} rejected the key or access to the selected model.`);
  }
}

// Opens a streamed completion and returns the provider's response once its
// headers arrive. Every failure the provider reports before the first byte is
// turned into an ApiError here, so the caller only ever streams a success.
export async function streamProvider(provider: ResolvedProvider, input: {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens: number;
  effort?: EffortLevel;
}, signal: AbortSignal) {
  // The timer covers only the wait for headers. A timeout signal passed to
  // fetch would stay attached to the body and cut a long answer mid-stream;
  // once headers arrive, the caller's signal alone governs the stream.
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener('abort', abort, { once: true });
  const firstByte = setTimeout(abort, FIRST_BYTE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await providerFetch(provider.baseUrl, '/chat/completions', provider.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
      // `include_usage` asks for a final chunk with token counts. Providers
      // that ignore it are still charged, from an estimate.
      // `reasoning_effort` goes out only when asked for, so a model that does
      // not know the parameter never sees it.
      body: JSON.stringify({ model: input.model, messages: input.messages, temperature: input.temperature, max_tokens: input.maxTokens, ...(input.effort ? { reasoning_effort: input.effort } : {}), stream: true, stream_options: { include_usage: true } }),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(502, `${provider.label} did not respond in time.`);
  } finally {
    clearTimeout(firstByte);
  }

  if (!response.ok) {
    // The label and status are safe to log; the key never is.
    console.error('Provider request failed', { provider: provider.label, status: response.status, model: input.model });
    if (response.status === 401 || response.status === 403) throw new KeyRejectedError(provider.label);
    if (response.status === 404) throw new ApiError(502, `${provider.label} does not currently offer the selected model.`);
    if (response.status === 429) throw new ApiError(429, `${provider.label} rate-limited the request. Try again later.`);
    throw new ApiError(502, `${provider.label} could not complete the request (HTTP ${response.status}).`);
  }
  if (!response.body) throw new ApiError(502, 'The provider returned an empty response.');
  return response;
}

// Some OpenAI-compatible servers ignore `stream: true` and answer with a single
// JSON body. That is still a valid answer, just delivered in one piece.
export function readCompletionJson(raw: string): { content: string; inputTokens: number; outputTokens: number } | null {
  let result: { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
  try {
    result = JSON.parse(raw);
  } catch {
    return null;
  }
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;
  const inputTokens = typeof result.usage?.prompt_tokens === 'number' ? Math.max(0, Math.trunc(result.usage.prompt_tokens)) : 0;
  const outputTokens = typeof result.usage?.completion_tokens === 'number' ? Math.max(0, Math.trunc(result.usage.completion_tokens)) : 0;
  return { content, inputTokens, outputTokens };
}

// Re-exported so callers do not need to know where the validation lives.
export { normalizeBaseUrl };
export type { ProviderModel };

// --- Managing connections ----------------------------------------------------

export function scopeOf(member: CurrentMember, requested: 'mine' | 'team'): string {
  if (requested === 'team' && member.role !== 'owner') throw new ApiError(403, 'Only the owner can set up a connection for the team.');
  return requested === 'team' ? TEAM_SCOPE : member.id;
}

// A connection the member may change: their own, or the team's for the
// owner. Someone else's own connection is not even acknowledged.
export async function manageableConnection(member: CurrentMember, id: string): Promise<ProviderRow> {
  const [row] = await getDb().select().from(providers).where(eq(providers.id, id)).limit(1);
  if (!row || (row.scope !== member.id && row.scope !== TEAM_SCOPE)) throw new ApiError(404, 'That model connection was not found.');
  if (row.scope === TEAM_SCOPE && member.role !== 'owner') throw new ApiError(403, 'Only the owner can change the team connection.');
  return row;
}

export async function addConnection(scope: string, input: { label: string; baseUrl: string; apiKey: string; models: ProviderModel[] }): Promise<ProviderRow> {
  const db = getDb();
  const [{ value: existing }] = await db.select({ value: sql<number>`count(*)` }).from(providers).where(eq(providers.scope, scope));
  if (existing >= MAX_CONNECTIONS) throw new ApiError(409, `There can be at most ${MAX_CONNECTIONS} connections here. Remove one first.`);
  const now = new Date();
  const row: ProviderRow = {
    id: crypto.randomUUID(),
    scope,
    label: input.label,
    baseUrl: input.baseUrl,
    apiKeyCiphertext: await encryptProviderKey(input.apiKey, encryptionSecret()),
    keyPreview: maskKey(input.apiKey),
    models: JSON.stringify(input.models),
    effortModels: '[]',
    chatModels: input.models.length > CHOOSE_CHAT_MODELS_ABOVE ? '[]' : null,
    checkStatus: 'ok',
    checkedAt: now,
    modelsFetchedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(providers).values(row);
  return row;
}

// The new key has passed `checkProvider` already, so the old one is replaced
// in a single write: until then, the chat keeps using the old key. Effort
// marks and the chat's choice stay, minus models the provider dropped.
export async function replaceKey(row: ProviderRow, apiKey: string, models: ProviderModel[]): Promise<ProviderRow> {
  const now = new Date();
  const changes = {
    apiKeyCiphertext: await encryptProviderKey(apiKey, encryptionSecret()),
    keyPreview: maskKey(apiKey),
    models: JSON.stringify(models),
    checkStatus: 'ok' as const,
    checkedAt: now,
    modelsFetchedAt: now,
    updatedAt: now,
  };
  await getDb().update(providers).set(changes).where(eq(providers.id, row.id));
  return { ...row, ...changes };
}

// Records how a check of the stored key went, and the model list it returned.
export async function recordCheck(row: ProviderRow, check: ProviderCheck): Promise<ProviderRow> {
  const now = new Date();
  const changes = check.ok
    ? { checkStatus: check.status, checkedAt: now, models: JSON.stringify(check.models), modelsFetchedAt: now }
    : { checkStatus: check.status, checkedAt: now };
  await getDb().update(providers).set(changes).where(eq(providers.id, row.id));
  return { ...row, ...changes };
}

// The provider refused the key during a chat. The connection is marked, so the
// settings say which key needs replacing; nothing else changes.
export async function markRejected(id: string) {
  await getDb().update(providers).set({ checkStatus: 'rejected', checkedAt: new Date() }).where(eq(providers.id, id));
}

export async function updateConnection(row: ProviderRow, changes: { label?: string; chatModels?: string[] | null; effortModels?: string[] }): Promise<ProviderRow> {
  const offered = new Set(parseModels(row.models).map((model) => model.id));
  for (const list of [changes.chatModels, changes.effortModels]) {
    if (list?.some((id) => !offered.has(id))) throw new ApiError(400, 'Only models this connection offers can be chosen.');
  }
  const update: Partial<ProviderRow> = { updatedAt: new Date() };
  if (changes.label !== undefined) update.label = changes.label;
  if (changes.chatModels !== undefined) update.chatModels = changes.chatModels === null ? null : JSON.stringify([...new Set(changes.chatModels)]);
  if (changes.effortModels !== undefined) update.effortModels = JSON.stringify([...new Set(changes.effortModels)]);
  await getDb().update(providers).set(update).where(eq(providers.id, row.id));
  return { ...row, ...update };
}

export async function removeConnection(row: ProviderRow) {
  await getDb().delete(providers).where(eq(providers.id, row.id));
}

// The member's own tokens through each connection, per day for the last seven
// days, today last. Days are UTC days, like the rest of the usage view.
export async function weeklyUsage(member: CurrentMember, ids: string[]): Promise<Map<string, number[]>> {
  const usage = new Map(ids.map((id) => [id, Array.from({ length: 7 }, () => 0)]));
  if (!ids.length) return usage;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(today - 6 * 86_400_000);
  const rows = await getDb()
    .select({
      providerId: usageEvents.providerId,
      day: sql<number>`cast((${usageEvents.createdAt} - ${since.getTime()}) / 86400000 as integer)`,
      tokens: sql<number>`sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens})`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.memberId, member.id), inArray(usageEvents.providerId, ids), gte(usageEvents.createdAt, since)))
    .groupBy(usageEvents.providerId, sql`2`);
  for (const row of rows) {
    const days = row.providerId ? usage.get(row.providerId) : undefined;
    if (days && row.day >= 0 && row.day < 7) days[row.day] = row.tokens;
  }
  return usage;
}

// A connection as the browser sees it: never the key, only its preview.
export function describeConnection(row: ProviderRow, member: CurrentMember, usage7d: number[]): ProviderConnection {
  return {
    id: row.id,
    scope: row.scope === TEAM_SCOPE ? 'team' : 'mine',
    label: row.label,
    baseUrl: row.baseUrl,
    keyPreview: row.keyPreview,
    models: parseModels(row.models),
    chatModels: chatModelIdsOf(row),
    effortModels: effortModelsOf(row),
    status: row.checkStatus,
    checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
    usage7d,
    canManage: row.scope === member.id || member.role === 'owner',
  };
}
