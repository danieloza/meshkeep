// Connections to model providers and the models they offer. See `common.ts`
// for how the contracts are used.

import { z } from 'zod';
import { EFFORT_LEVELS, type EffortLevel } from '@/lib/effort';
import { id, isoDate } from './common';

// A model as the chat and the settings show it. In the chat, `effort` is true
// for a model marked as accepting `reasoning_effort`, and `connectionId` says
// which connection the model is reached through; it is absent only for the
// key set on the server.
export const providerModel = z.object({
  id: z.string(),
  label: z.string(),
  effort: z.boolean().optional(),
  connectionId: id.optional(),
  connectionLabel: z.string().optional(),
});
export type ProviderModel = z.infer<typeof providerModel>;

export const effortLevel = z.enum(EFFORT_LEVELS);
export type { EffortLevel };

// Where the connection that answers by default came from, so the interface can
// say whose key pays for a message.
export const providerOrigin = z.enum(['member', 'team', 'environment']);
export type ProviderOrigin = z.infer<typeof providerOrigin>;

// Whose connection: the member's own, or the team's, which only the owner sets.
export const connectionScope = z.enum(['mine', 'team']);
export type ConnectionScope = z.infer<typeof connectionScope>;

// How the key fared when last checked. `rejected`: the provider refused the
// key. `unreachable`: no answer at the address. `failed`: any other error.
export const checkStatus = z.enum(['ok', 'rejected', 'unreachable', 'failed']);
export type CheckStatus = z.infer<typeof checkStatus>;

// A stored connection as the browser sees it. The key comes back masked,
// never in full.
export const providerConnection = z.object({
  id,
  scope: connectionScope,
  label: z.string(),
  baseUrl: z.string(),
  keyPreview: z.string(),
  // Everything the provider offers.
  models: z.array(providerModel),
  // Ids offered in the chat; null offers all of them.
  chatModels: z.array(z.string()).nullable(),
  // Only ids that are still in `models`.
  effortModels: z.array(z.string()),
  // Null until the key has been checked once.
  status: checkStatus.nullable(),
  checkedAt: isoDate.nullable(),
  // The viewer's own tokens through this connection, one number per day, the
  // oldest first and today last.
  usage7d: z.array(z.number().int()).length(7),
  // The member's own connections, and the team's for the owner.
  canManage: z.boolean(),
});
export type ProviderConnection = z.infer<typeof providerConnection>;

export const effectiveProvider = z.object({
  label: z.string(),
  origin: providerOrigin,
  modelCount: z.number().int(),
});
export type EffectiveProvider = z.infer<typeof effectiveProvider>;

// GET /api/providers: the member's connections, then the team's.
export const providerConnections = z.object({
  connections: z.array(providerConnection),
  canSetTeam: z.boolean(),
  // How many connections each member, and the team, may have.
  limit: z.number().int(),
  // What answers when a message names no connection.
  effective: effectiveProvider.nullable(),
});
export type ProviderConnections = z.infer<typeof providerConnections>;

const label = z.string().trim().min(1).max(60);
const apiKey = z.string().trim().min(8).max(400);

// POST /api/providers
export const addConnectionRequest = z.object({
  label,
  baseUrl: z.string().trim().min(1).max(400),
  apiKey,
  scope: connectionScope.default('mine'),
});
export type AddConnectionRequest = z.input<typeof addConnectionRequest>;

// POST /api/providers, PUT /api/providers/:id/key, POST /api/providers/:id/check
// and PATCH /api/providers/:id all answer with the connection as it now is.
export const connectionResponse = z.object({ connection: providerConnection });
export type ConnectionResponse = z.infer<typeof connectionResponse>;

// PUT /api/providers/:id/key: the new key is checked before it replaces the
// old one, which keeps working if the check fails.
export const replaceKeyRequest = z.object({ apiKey });
export type ReplaceKeyRequest = z.input<typeof replaceKeyRequest>;

const modelIds = z.array(z.string().trim().min(1).max(200)).max(500);

// PATCH /api/providers/:id: any of these; every model id has to be one the
// connection offers.
export const updateConnectionRequest = z.object({
  label: label.optional(),
  chatModels: modelIds.nullable().optional(),
  effortModels: modelIds.optional(),
}).refine((value) => value.label !== undefined || value.chatModels !== undefined || value.effortModels !== undefined, { message: 'Nothing to change.' });
export type UpdateConnectionRequest = z.input<typeof updateConnectionRequest>;

// DELETE /api/providers/:id
export const removeConnectionResponse = z.object({ removed: z.literal(true) });
export type RemoveConnectionResponse = z.infer<typeof removeConnectionResponse>;
