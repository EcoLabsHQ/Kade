'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/supabase/server';
import { recordResidencyServiceFeePayment } from '@/lib/residency/service-fee-server';
import { createSelfSession, type SelfSessionResult } from '@/lib/residency/self';
import { issuePermit, type PermitIssuanceResult } from '@/lib/residency/permit';
import type { RecordFeeResult } from '@/lib/payments/preapproval-fee';

/**
 * The Residency step's server actions.
 *
 * Each one re-reads the session server-side; none trusts a value from the
 * browser beyond the transaction hash and the connected address, and both of
 * those are re-verified against the chain by `recordResidencyServiceFeePayment`.
 *
 * The Self and permit actions are gated: the Self action reports
 * `not-configured`/`unavailable` rather than inventing a verification URL, and
 * the permit action reports `not-configured`/`blocked` rather than issuing. No
 * `kade.kyc.v1` or permit is written by either action in this build.
 */

/**
 * Verify a service-fee receipt and record the hash when it proves out.
 *
 * The amount and the treasury are server-side (`fee_schedule` + environment);
 * the browser supplies only the hash and the connected address, exactly as the
 * pre-approval rail does.
 */
export async function recordResidencyServiceFeePaymentAction(
  txHash: string,
  payer: string,
): Promise<RecordFeeResult> {
  const session = await getSessionUser();
  if (!session) return { status: 'unauthenticated' };

  const result = await recordResidencyServiceFeePayment(
    session.userId,
    txHash,
    payer,
  );
  if (result.status === 'paid') {
    revalidatePath('/residency');
  }
  return result;
}

/** Start Self identity verification, or report why it cannot run. */
export type SelfSessionActionOutcome =
  | SelfSessionResult
  | { readonly status: 'unauthenticated' };

/**
 * Create a Self verification session for the signed-in resident and return the
 * hosted `verificationUrl`.
 *
 * `externalUuid` is the profile id, so the webhook's `external_uuid` resolves
 * back to this resident. The action never invents a URL: without the Self
 * configuration it reports `not-configured`, and a missing session reports
 * `unauthenticated`.
 */
export async function createSelfSessionAction(): Promise<SelfSessionActionOutcome> {
  const session = await getSessionUser();
  if (!session) return { status: 'unauthenticated' };
  return createSelfSession(session.userId);
}

/** Attempt permit issuance, or report the gate that blocks it. */
export async function issueResidencyPermitAction(): Promise<PermitIssuanceResult> {
  const session = await getSessionUser();
  if (!session) return { status: 'unauthenticated' };
  const result = issuePermit();
  if (result.status === 'issued') {
    revalidatePath('/residency');
  }
  return result;
}
