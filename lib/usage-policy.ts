// What an abandoned answer costs.
//
// A run is abandoned when the worker stopped before it could save the answer:
// the tab was closed during a long answer and the platform's grace period for
// unfinished work ran out, or the runtime restarted. The provider may have
// generated anything from nothing to the full `maxTokens` by then, and there is
// no way to know: its usage report comes at the end of the stream, which never
// arrived.
//
// The charge is written as an ordinary usage event, dated when the run
// started, so it counts against the member's daily and monthly limits and
// shows in the usage view like any other answer.

export type AbandonedRun = {
  // Estimated from the prompt as sent: instructions, files and history.
  reservedInputTokens: number;
  // The answer's ceiling, `maxTokens` from the request (64 to 4096).
  reservedOutputTokens: number;
};

export type Charge = { inputTokens: number; outputTokens: number };

// The whole reservation. The key's owner pays for whatever the provider
// generated, and the limits are there to protect them. Nobody knows how much
// that was, so the ceiling is the only figure that cannot undercount. Charging
// less would bring back what reservations closed: an answer abandoned by
// closing the tab would cost its author less than one that finished. Being
// wrong costs at most `maxTokens`, on a rare event.
export function abandonedRunCharge(run: AbandonedRun): Charge {
  return { inputTokens: run.reservedInputTokens, outputTokens: run.reservedOutputTokens };
}
