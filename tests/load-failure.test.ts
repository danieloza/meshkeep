import { describe, expect, it } from 'vitest';
import { loadFailure } from '@/features/shell/load-failure';
import { ApiRequestError } from '@/lib/api-client';

describe('what the dashboard does when its first load fails', () => {
  it('asks to sign in when nobody is signed in', () => {
    expect(loadFailure(new ApiRequestError(401, 'Sign in to continue.'))).toEqual({ kind: 'signed-out' });
  });

  it('says why a signed-in account is not let in, in the server’s words', () => {
    expect(loadFailure(new ApiRequestError(403, 'No active invitation exists for this cloud.'))).toEqual({ kind: 'no-access', reason: 'No active invitation exists for this cloud.' });
    expect(loadFailure(new ApiRequestError(403, 'This account has been suspended.'))).toEqual({ kind: 'no-access', reason: 'This account has been suspended.' });
  });

  it('keeps the general notice for other failures', () => {
    expect(loadFailure(new ApiRequestError(500, 'The server is not responding right now.'))).toEqual({ kind: 'error', message: 'Could not load application data.' });
    // A request that never reached the server: the browser's own words.
    expect(loadFailure(new TypeError('Failed to fetch'))).toEqual({ kind: 'error', message: 'Failed to fetch' });
    expect(loadFailure('nonsense')).toEqual({ kind: 'error', message: 'Could not load application data.' });
  });
});
