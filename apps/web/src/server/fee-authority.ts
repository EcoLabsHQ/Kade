import {
  FEE_KEYS,
  preapprovalFeeUsdc,
  residencyServiceFeeUsdc,
  type FeeAmount,
  type FeeMode,
} from '@kade/shared';

/**
 * Authoritative fee computation.
 *
 * Contract section 2.1: "The fee is calculated server-side from the active
 * `fee_schedule`; the client may display it but cannot override it."
 *
 * The arithmetic lives once, in `@kade/shared`. This module is the only place
 * the app is allowed to call it, and it refuses any input that tries to carry
 * a client-supplied amount.
 */

/** Keys a browser request must never carry when asking for a fee. */
export const CLIENT_FORBIDDEN_FEE_KEYS = [
  'amount',
  'fee',
  'total',
  'value',
  'usdc',
] as const;

export interface PreapprovalFeeRequest {
  readonly mode: FeeMode;
  readonly householdSize: number;
}

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

/** Pre-approval fee in USDC, derived from the frozen shared formula. */
export function authoritativePreapprovalFee(
  request: PreapprovalFeeRequest,
): number {
  assertNoClientSuppliedAmount(
    request as unknown as Readonly<Record<string, unknown>>,
  );
  return preapprovalFeeUsdc(request.mode, request.householdSize);
}

export interface AuthoritativeFeeAmounts {
  readonly mode: FeeMode;
  readonly preapproval: FeeAmount;
  readonly service: FeeAmount;
}

/**
 * The full authoritative fee set. Week 1 charges only the pre-approval fee;
 * the service fee is seeded but not charged (contract section 2.1).
 */
export function authoritativeFeeAmounts(
  mode: FeeMode,
  householdSize: number,
): AuthoritativeFeeAmounts {
  return {
    mode,
    preapproval: {
      key: FEE_KEYS.preapproval,
      mode,
      currency: 'USDC',
      amount: authoritativePreapprovalFee({ mode, householdSize }),
    },
    service: {
      key: FEE_KEYS.service,
      mode,
      currency: 'USDC',
      amount: residencyServiceFeeUsdc(mode),
    },
  };
}
