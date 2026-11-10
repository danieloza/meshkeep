import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAIM_TIMEOUT_MS, claimFirst } from '@/features/shell/claim-first';

// What the dashboard depends on: it loads only after this settles, so the
// claim has to come first when it answers, and must not hold the page when it
// does not.

async function settled(promise: Promise<void>) {
  let done = false;
  void promise.then(() => { done = true; });
  await vi.advanceTimersByTimeAsync(0);
  return done;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('claiming before the dashboard loads', () => {
  it('waits for a claim that answers, and does not cancel it afterwards', async () => {
    let answer = () => {};
    let signal: AbortSignal | undefined;
    const waiting = claimFirst((s) => { signal = s; return new Promise<void>((resolve) => { answer = resolve; }); });

    expect(await settled(waiting)).toBe(false);
    answer();
    expect(await settled(waiting)).toBe(true);

    await vi.advanceTimersByTimeAsync(CLAIM_TIMEOUT_MS * 2);
    expect(signal?.aborted).toBe(false);
  });

  it.each([
    ['refused', new Error('The request failed (403).')],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('goes on after %s', async (_name, failure) => {
    expect(await settled(claimFirst(() => Promise.reject(failure)))).toBe(true);
  });

  it('gives up on a claim that never answers, and cancels the request', async () => {
    let signal: AbortSignal | undefined;
    const waiting = claimFirst((s) => { signal = s; return new Promise(() => undefined); });

    await vi.advanceTimersByTimeAsync(CLAIM_TIMEOUT_MS - 1);
    expect(await settled(waiting)).toBe(false);
    expect(signal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(await settled(waiting)).toBe(true);
    expect(signal?.aborted).toBe(true);
  });
});
