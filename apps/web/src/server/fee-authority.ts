/**
 * Client-supplied fee guard.
 *
 * Contract section 2.1: "The fee is calculated server-side from the active
 * `fee_schedule`; the client may display it but cannot override it."
 *
 * The runtime authority is `@/lib/onboarding/fee-server`, which reads the
 * `fee_schedule` row and calls `public.preapproval_fee_usdc`. The shared formula
 * in `@kade/shared` only seeds and verifies those rows.
 *
 * This module holds a small, defensive guard that refuses a request carrying a
 * client-supplied amount. It guards any object-shaped request boundary that
 * could be confused with a fee payload. It is not on the live Step 2 write path:
 * that path is the `save_onboarding_step2` RPC, whose snapshot type has no fee
 * field and whose database writes the RLS column grant already withholds
 * `preapproval_usdc` from. The guard remains because the forbidden-key contract
 * is cheap to keep and is used by callers that accept an untrusted record; it
 * must not be described as protecting a path it does not reach.
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
