/**
 * Fee model.
 *
 * Source: docs/week-1-frozen-delivery-contract.md section 2.1 (Frozen fee
 * model), which resolves the DOCX section 7 fee table and Appendix B.2.
 *
 * Frozen facts:
 *   - Demo:       pre-approval = 1.00 + 0.25 x household_size (USDC).
 *                 household_size = 3 yields 1.75.
 *   - Production: XCG 500 + XCG 100 per household member, settled in USDC.
 *                 household of 3 yields 447 USDC.
 *   - Service fee: demo 10 USDC, production 2,000 USDC.
 *   - The applicant is included in household_size that drives the multiplier.
 *   - Both fees live in the single `fee_schedule` table with a `mode` column
 *     (`demo | production`). One environment variable selects the mode.
 *   - No amount is hard-coded in the client: the server computes from the
 *     active schedule.
 *
 * This module is the single implementation of the frozen formula. It is used
 * to seed `fee_schedule` and to verify that the seeded rows are correct. The
 * runtime reads the seeded rows, not these constants.
 */

import { sourced, type Sourced } from './provenance.js';

export type FeeMode = 'demo' | 'production';

/**
 * XCG per USDC.
 *
 * [documented] The build guide section 8 states the card settles XCG "at the
 * CBCS peg (1.79)". This is the only documented rate, and it is the rate that
 * reproduces the contract's worked example: (500 + 100 x 3) / 1.79 = 446.9,
 * which rounds to the stated 447 USDC.
 */
export const XCG_PER_USDC = 1.79;

/** Stable keys for `fee_schedule.key`. */
export const FEE_KEYS = {
  /** Pre-approval fee, charged in Week 1. */
  preapproval: 'preapproval',
  /** Residency service fee. Seeded in Week 1, not charged (contract 2.1). */
  service: 'service',
} as const;

export type FeeKey = (typeof FEE_KEYS)[keyof typeof FEE_KEYS];

export interface FeeAmount {
  readonly key: FeeKey;
  readonly mode: FeeMode;
  readonly currency: 'USDC';
  /** Whole USDC, or an exact decimal for the demo pre-approval fee. */
  readonly amount: number;
}

/**
 * Pre-approval fee in USDC.
 *
 * Demo is computed in cents so that 1.00 + 0.25 x 3 is exactly 1.75 rather
 * than a floating-point approximation.
 */
export function preapprovalFeeUsdc(mode: FeeMode, householdSize: number): number {
  if (!Number.isInteger(householdSize) || householdSize < 1) {
    throw new RangeError(`householdSize must be an integer >= 1, received ${householdSize}`);
  }
  if (mode === 'demo') {
    return (100 + 25 * householdSize) / 100;
  }
  return Math.round((500 + 100 * householdSize) / XCG_PER_USDC);
}

/** Residency service fee in USDC. */
export function residencyServiceFeeUsdc(mode: FeeMode): number {
  return mode === 'demo' ? 10 : 2000;
}

/**
 * The pre-approval fee split into its documented parts.
 *
 * The receipt shows the base and the per-member component separately, so the
 * arithmetic has to be available as data rather than only as a total. The total
 * is computed the same way `preapprovalFeeUsdc` computes it, and a test asserts
 * the two agree, so a receipt can never disagree with the charge.
 */
export interface PreapprovalBreakdown {
  readonly baseUsdc: number;
  readonly perMemberUsdc: number;
  readonly householdSize: number;
  readonly extraMembers: number;
  readonly totalUsdc: number;
}

export function preapprovalFeeBreakdown(
  mode: FeeMode,
  householdSize: number,
): PreapprovalBreakdown {
  if (!Number.isInteger(householdSize) || householdSize < 1) {
    throw new RangeError(
      `householdSize must be an integer >= 1, received ${householdSize}`,
    );
  }
  // The first household member is the applicant's own line; the rest are the
  // derived permits the reference itemises.
  const extraMembers = householdSize - 1;

  if (mode === 'demo') {
    return {
      baseUsdc: 1,
      perMemberUsdc: 0.25,
      householdSize,
      extraMembers,
      totalUsdc: (100 + 25 * householdSize) / 100,
    };
  }
  return {
    baseUsdc: 500 / XCG_PER_USDC,
    perMemberUsdc: 100 / XCG_PER_USDC,
    householdSize,
    extraMembers,
    totalUsdc: Math.round((500 + 100 * householdSize) / XCG_PER_USDC),
  };
}

/**
 * The full `fee_schedule` seed for a mode. Mirrors the contract's fee table.
 */
export function feeScheduleFor(mode: FeeMode): readonly FeeAmount[] {
  return [
    {
      key: FEE_KEYS.preapproval,
      mode,
      currency: 'USDC',
      amount: preapprovalFeeUsdc(mode, 1),
    },
    {
      key: FEE_KEYS.service,
      mode,
      currency: 'USDC',
      amount: residencyServiceFeeUsdc(mode),
    },
  ];
}

/**
 * Human-readable production equivalent, shown beside demo amounts.
 * The build guide requires the receipt detail to log the production
 * equivalent while demo pricing is active.
 */
export function productionEquivalentUsdc(householdSize: number): Sourced<number> {
  return sourced(
    preapprovalFeeUsdc('production', householdSize),
    'documented',
    'derived from the DOCX fee table via the CBCS peg',
  );
}
