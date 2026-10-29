// Model providers and the models they offer. See `common.ts` for how the
// contracts are used.

import { z } from 'zod';

export const providerModel = z.object({ id: z.string(), label: z.string() });
export type ProviderModel = z.infer<typeof providerModel>;

// Where the configuration that answers a member came from, so the interface
// can say whose key pays for a message.
export const providerOrigin = z.enum(['member', 'team', 'environment']);
export type ProviderOrigin = z.infer<typeof providerOrigin>;

// A stored configuration as the browser sees it. The key comes back masked,
// never in full.
export const providerSummary = z.object({
  label: z.string(),
  baseUrl: z.string(),
  keyPreview: z.string(),
  modelCount: z.number().int(),
});
export type ProviderSummary = z.infer<typeof providerSummary>;

export const effectiveProvider = z.object({
  label: z.string(),
  origin: providerOrigin,
  modelCount: z.number().int(),
});
export type EffectiveProvider = z.infer<typeof effectiveProvider>;

// GET /api/provider
export const providerState = z.object({
  mine: providerSummary.nullable(),
  team: providerSummary.nullable(),
  canSetTeam: z.boolean(),
  effective: effectiveProvider.nullable(),
});
export type ProviderState = z.infer<typeof providerState>;

// PUT /api/provider
export const saveProviderRequest = z.object({
  label: z.string().trim().min(1).max(60),
  baseUrl: z.string().trim().min(1).max(400),
  apiKey: z.string().trim().min(8).max(400),
  // Only the owner may write the team default; anyone may write their own.
  scope: z.enum(['team', 'mine']).default('mine'),
});
export type SaveProviderRequest = z.input<typeof saveProviderRequest>;

export const saveProviderResponse = z.object({
  saved: z.literal(true),
  modelCount: z.number().int(),
  keyPreview: z.string(),
});
export type SaveProviderResponse = z.infer<typeof saveProviderResponse>;

// DELETE /api/provider?scope=…: `removed` is false when there was nothing to
// remove.
export const removeProviderResponse = z.object({ removed: z.boolean() });
export type RemoveProviderResponse = z.infer<typeof removeProviderResponse>;
