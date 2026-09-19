/**
 * Client-supplied fee guard.
 *
 * Contract section 2.1: "The fee is calculated server-side from the active
 * `fee_schedule`; the client may display it but cannot override it."
 *
 * The runtime authority is now `@/lib/onboarding/fee-server`, which reads the
 * `fee_schedule` row and calls `public.preapproval_fee_usdc`. The shared
 * formula in `@kade/shared` only seeds and verifies those rows. What remains
 * here is the one part still used at the write boundary: a guard that refuses a
 * request carrying a client-supplied amount. The onboarding persistence seam
 * calls it before saving, so a smuggled fee fails rather than being displayed
 * or stored.
 */

/** Keys a browser request must never carry when asking for a fee. */
export const CLIENT_FORBIDDEN_FEE_KEYS = [
  'amount',
  'fee',
  'total',
  'value',
  'usdc',
] as const;

export function assertNoClientSuppliedAmount(
  input: Readonly<Record<string, unknown>>,
): void {
  for (const key of CLIENT_FORBIDDEN_FEE_KEYS) {
    if (key in input) {
      throw new Error(
        `The client may not supply the fee ("${key}"). The server computes it ` +
          'from the active fee schedule (contract section 2.1).',
      );
    }
  }
}
