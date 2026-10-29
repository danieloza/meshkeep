// Contracts: the shape of each request and response that crosses between the
// browser and the API, written once as zod schemas in `lib/contracts`.
//
// The server parses request bodies with them, and the API tests parse every
// response with them, so a route that drifts from its contract fails a test.
// The browser imports only their types (`import type`), which keeps zod out
// of the browser bundle.

import { z } from 'zod';

// Every record MeshKeep creates gets its id from `crypto.randomUUID()`.
export const id = z.uuid();
// `JSON.stringify` writes a `Date` as an ISO string, so dates travel as text.
export const isoDate = z.iso.datetime();

export const visibility = z.enum(['private', 'selected', 'team']);
export type Visibility = z.infer<typeof visibility>;

export const shareRole = z.enum(['reader', 'editor']);
export type ShareRole = z.infer<typeof shareRole>;

// Every route answers a failure with this shape.
export const apiError = z.object({ error: z.string() });
export type ApiError = z.infer<typeof apiError>;

// What the browser reads before it knows whether the call succeeded: the
// response on success, `error` on failure.
export type ApiReply<T> = Partial<T> & Partial<ApiError>;

export const deletedResponse = z.object({ deleted: z.literal(true) });
export type DeletedResponse = z.infer<typeof deletedResponse>;
