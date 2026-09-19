import type { FeeMode } from '@kade/shared';

/**
 * Fee display types and the preview arithmetic.
 *
 * The authoritative pre-approval fee is computed in the database by
 * `public.preapproval_fee_usdc(mode, household_size)`, which reads the active
 * `fee_schedule` rows (contract section 2.1). This module is the client-safe
 * half: it names the shape of the server-resolved schedule and previews it, so
 * no browser code ever reads the shared formula or a hard-coded amount.
 *
 * The arithmetic here mirrors `public.preapproval_fee_usdc` exactly. The seed
 * generator asserts the two agree for household sizes 1–1000 before it writes
 * a single `fee_schedule` row (ADR 0005), so a preview cannot drift from the
 * database. A preview is never a write path: the value that is stored and
 * charged is recomputed by the database and read back from
 * `applications.preapproval_usdc`.
 */

/** The active `fee_schedule` pre-approval row, resolved on the server. */
export interface PreapprovalFeeSchedule {
  readonly mode: FeeMode;
  readonly baseUsdc: number;
  readonly perMemberUsdc: number;
  readonly roundingScale: number;
}

export interface PreapprovalFeeBreakdown {
  readonly baseUsdc: number;
  readonly perMemberUsdc: number;
  readonly householdSize: number;
  readonly householdUsdc: number;
  readonly totalUsdc: number;
}

/**
 * Previews the pre-approval fee from the server-resolved schedule.
 *
 * The household size includes the applicant (contract section 2.1), so it is
 * always `1 + members.length`. Invalid sizes throw, matching the database
 * function's `22023` rejection, rather than returning a value it would refuse.
 */
export function preapprovalBreakdownFromSchedule(
  schedule: PreapprovalFeeSchedule,
  householdSize: number,
): PreapprovalFeeBreakdown {
  if (!Number.isInteger(householdSize) || householdSize < 1) {
    throw new RangeError(
      `householdSize must be an integer >= 1, received ${householdSize}`,
    );
  }
  const householdUsdc = schedule.perMemberUsdc * householdSize;
  const factor = 10 ** schedule.roundingScale;
  const totalUsdc =
    Math.round((schedule.baseUsdc + householdUsdc) * factor) / factor;
  return {
    baseUsdc: schedule.baseUsdc,
    perMemberUsdc: schedule.perMemberUsdc,
    householdSize,
    householdUsdc,
    totalUsdc,
  };
}
