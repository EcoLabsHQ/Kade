'use server';

import { revalidatePath } from 'next/cache';
import { getSessionUser } from '@/lib/supabase/server';
import { recordResidencyServiceFeePayment } from '@/lib/residency/service-fee-server';
import { createSelfSession, type SelfSessionResult } from '@/lib/residency/self';
import { issuePermit, type PermitIssuanceResult } from '@/lib/residency/permit';
import type { RecordFeeResult } from '@/lib/payments/preapproval-fee';
import type { Membership } from '@/lib/membership/abi';
import {
  prepareMembershipTransitionFromEnv,
  type MembershipTransitionOutcome,
} from '@/lib/membership/server';
import {
  mintMembershipForClaimFromEnv,
  type MembershipMintOutcome,
} from '@/lib/membership/mint';
import type { MembershipClaimTarget } from '@/lib/membership/plan';
import { membershipTransitionStore } from '@/lib/membership/store';

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
    // The residency milestone is the seam that prepares the Colosseum Resident
    // credential. It is best-effort and prepare-only: the membership issuance
    // gate is not configured in this build, so this reports `not-configured`
    // and writes nothing. Nothing is signed or broadcast here.
    //
    // OPEN QUESTION (product): is an issued residency permit the trigger for the
    // Colosseum Resident credential, or is the Colosseum milestone itself? This
    // wiring follows the real state change (the permit); the Colosseum demo
    // milestone is deliberately not wired, because it is a declared demo and
    // issuing a real credential from it is a policy decision.
    await prepareMembershipTransitionFromEnv(
      session.userId,
      'resident',
      membershipTransitionStore(),
    );
  }
  return result;
}

/**
 * Prepare a membership transition for the signed-in resident, or report the gate
 * that blocks it.
 *
 * Prepare-only: it returns a reviewable plan with `sent: false`. There is no
 * sign or broadcast path. The Colosseum citizenship milestone has no real Kade
 * state change yet, so this action is the seam for it and is not auto-wired; the
 * open question is recorded on the residency flow point above.
 */
export type MembershipTransitionActionOutcome =
  | MembershipTransitionOutcome
  | { readonly status: 'unauthenticated'; readonly sent: false };

export async function prepareMembershipTransitionAction(
  target: Membership,
): Promise<MembershipTransitionActionOutcome> {
  const session = await getSessionUser();
  if (!session) return { status: 'unauthenticated', sent: false };
  return prepareMembershipTransitionFromEnv(
    session.userId,
    target,
    membershipTransitionStore(),
  );
}

/** The claim-mint action's result. */
export type MembershipClaimActionOutcome =
  | MembershipMintOutcome
  | { readonly status: 'unauthenticated'; readonly sent: false; readonly reason: string };

/**
 * Mint the credential a Colosseum claim warrants.
 *
 * This is the claim trigger the human fixed: claiming Colosseum Residency mints
 * the Resident credential; claiming Citizenship promotes to Citizen. Nothing is
 * trusted from the client — the profile comes from the session and the four
 * real checks are re-derived server-side. The backend executes the owner-Safe
 * call with its owner key; the resident signs nothing and pays nothing.
 */
export async function claimMembershipAction(
  target: MembershipClaimTarget,
): Promise<MembershipClaimActionOutcome> {
  const session = await getSessionUser();
  if (!session) {
    return {
      status: 'unauthenticated',
      sent: false,
      reason: 'Your session expired. Sign in again to claim.',
    };
  }
  const outcome = await mintMembershipForClaimFromEnv(session.userId, target);
  if (outcome.status === 'sent') {
    revalidatePath('/residency');
  }
  return outcome;
}
