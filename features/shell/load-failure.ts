import { ApiRequestError } from '@/lib/api-client';

// What the dashboard does when its first load fails. Everything it loads
// needs a member, so the requests fail together and one error speaks for all.
//
// 401: nobody is signed in, neither by session nor by the platform.
// 403: someone is signed in, but this cloud does not let them in: no
//      invitation for that account, a suspended account, or a full team. The
//      server says which, and the screen shows it.
// Anything else leaves the dashboard empty with a notice.
export type LoadFailure =
  | { kind: 'signed-out' }
  | { kind: 'no-access'; reason: string }
  | { kind: 'error'; message: string };

const COULD_NOT_LOAD = 'Could not load application data.';

export function loadFailure(error: unknown): LoadFailure {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return { kind: 'signed-out' };
    if (error.status === 403) return { kind: 'no-access', reason: error.message };
    return { kind: 'error', message: COULD_NOT_LOAD };
  }
  return { kind: 'error', message: error instanceof Error ? error.message : COULD_NOT_LOAD };
}
