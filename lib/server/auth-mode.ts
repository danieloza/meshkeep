import 'server-only';

import { env } from 'cloudflare:workers';

// `sites`: OpenAI Sites sits in front of the worker and sets the
// `oai-authenticated-user-*` headers, so they identify the user.
// `standalone`: nothing sets those headers, so any value in them came from the
// client. They are ignored and the owner signs in with OWNER_SETUP_TOKEN.
//
// Standalone is the default because the mistake is not symmetric. A Sites
// deployment that forgets `AUTH_MODE=sites` only loses ChatGPT sign-in; a
// standalone deployment that trusted the headers would let anyone sign in as
// anyone.
export type AuthMode = 'sites' | 'standalone';

export function getAuthMode(): AuthMode {
  return env.AUTH_MODE?.trim() === 'sites' ? 'sites' : 'standalone';
}
