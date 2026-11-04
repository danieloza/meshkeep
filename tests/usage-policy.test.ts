import { describe, expect, it } from 'vitest';
import { abandonedRunCharge } from '@/lib/usage-policy';

// Whatever the policy, these hold: the charge is a whole number of tokens,
// never negative, and never more than the run reserved. The reservation is
// what the limits already counted while the run was going.
describe('abandonedRunCharge', () => {
  const runs = [
    { reservedInputTokens: 0, reservedOutputTokens: 64 },
    { reservedInputTokens: 1_234, reservedOutputTokens: 2_048 },
    { reservedInputTokens: 30_000, reservedOutputTokens: 4_096 },
  ];

  it.each(runs)('stays within the reservation: $reservedInputTokens + $reservedOutputTokens', (run) => {
    const charge = abandonedRunCharge(run);
    for (const [spent, reserved] of [[charge.inputTokens, run.reservedInputTokens], [charge.outputTokens, run.reservedOutputTokens]]) {
      expect(Number.isInteger(spent)).toBe(true);
      expect(spent).toBeGreaterThanOrEqual(0);
      expect(spent).toBeLessThanOrEqual(reserved);
    }
  });

  it('charges the prompt, which the provider had read before anything else', () => {
    expect(abandonedRunCharge({ reservedInputTokens: 1_234, reservedOutputTokens: 2_048 }).inputTokens).toBe(1_234);
  });
});
