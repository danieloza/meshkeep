// The dashboard claims before it loads, so that everything loaded afterwards
// shows the name the platform has now (see `syncPlatformName`). That puts the
// claim in front of the whole page, so it must never be able to hold the page.

// Long enough for a cold worker and a slow database, short enough that nobody
// mistakes the loading screen for a broken app.
export const CLAIM_TIMEOUT_MS = 5_000;

// Settles once the claim has answered, failed, or run out of time; it never
// rejects. Running out of time cancels the request. The load then goes on with
// what the server has: nothing from a claim reaches the screen directly, so a
// rename the server finished anyway shows on the next load.
//
// The race is there as well as the cancelling so that the page does not depend
// on the request honouring its signal.
export function claimFirst(claim: (signal: AbortSignal) => Promise<unknown>, timeoutMs = CLAIM_TIMEOUT_MS): Promise<void> {
  const controller = new AbortController();
  const outOfTime = new Promise<void>((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(), { once: true });
  });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const answered = claim(controller.signal).then(() => undefined, () => undefined);
  return Promise.race([answered, outOfTime]).finally(() => clearTimeout(timer));
}
