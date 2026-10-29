// Who is signed in, and the routes that sign people in and out. See
// `common.ts` for how the contracts are used.

import { z } from 'zod';
import { id, memberRole } from './common';
import { effectiveProvider, providerModel } from './providers';
import { memberLimits } from './usage';

// GET /api/bootstrap: what the dashboard needs before its first render.
export const bootstrapResponse = z.object({
  member: z.object({ id, displayName: z.string(), email: z.string(), role: memberRole }),
  // Missing for a member without a limits row.
  limits: memberLimits.optional(),
  usage: z.object({
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    monthlyTokens: z.number().int(),
  }),
  // The models of the provider that answers this member.
  models: z.array(providerModel),
  provider: effectiveProvider.pick({ label: true, origin: true }).nullable(),
});
export type BootstrapResponse = z.infer<typeof bootstrapResponse>;

// Every sign-in route answers with the session cookie and this body.
export const signedIn = z.object({
  authenticated: z.literal(true),
  member: z.object({ displayName: z.string() }),
});
export type SignedIn = z.infer<typeof signedIn>;

// POST /api/auth/claim answers `signedIn`.

// POST /api/auth/join
export const joinRequest = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,100}$/),
  displayName: z.string().trim().min(2).max(100),
});
export type JoinRequest = z.input<typeof joinRequest>;

// A reconnect link signs an existing member back in instead of adding one.
export const joinResponse = signedIn.extend({ reconnected: z.boolean() });
export type JoinResponse = z.infer<typeof joinResponse>;

// POST /api/auth/setup: the owner proves ownership with OWNER_SETUP_TOKEN.
export const MIN_SETUP_TOKEN_LENGTH = 32;

export const setupRequest = z.object({
  token: z.string().min(MIN_SETUP_TOKEN_LENGTH).max(200),
  displayName: z.string().trim().min(2).max(100).optional(),
});
export type SetupRequest = z.input<typeof setupRequest>;

// `created` is false when the key signs the existing owner back in.
export const setupResponse = signedIn.extend({ created: z.boolean() });
export type SetupResponse = z.infer<typeof setupResponse>;

// POST /api/auth/logout
export const signedOut = z.object({ authenticated: z.literal(false) });
export type SignedOut = z.infer<typeof signedOut>;
