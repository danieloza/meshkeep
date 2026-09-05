import 'server-only';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Cache-Control', 'no-store, private');
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('X-Content-Type-Options', 'nosniff');
  return Response.json(data, { ...init, headers });
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json({ error: error.message }, { status: error.status });
  }
  console.error('Unhandled API error:', error instanceof Error ? error.message : 'unknown error');
  return json({ error: 'An unexpected error occurred.' }, { status: 500 });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) throw new ApiError(403, 'Missing Origin header.');

  const requestUrl = new URL(request.url);
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new ApiError(403, 'Invalid request origin.');
  }
  if (originUrl.origin !== requestUrl.origin) {
    throw new ApiError(403, 'Request from a disallowed origin.');
  }
}

export async function readJson(request: Request, maxBytes = 64_000) {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError(413, 'The request is too large.');
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ApiError(413, 'The request is too large.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(400, 'Invalid JSON.');
  }
}
