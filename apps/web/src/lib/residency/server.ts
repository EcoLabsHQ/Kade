import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readFeeMode } from '@/lib/env';
import { loadFeePayment } from '@/lib/payments/server';
import {
  deriveResidencyView,
  sumQualifiedUsd,
  type IdentityFact,
  type PermitFact,
  type ResidencyFacts,
  type ResidencyView,
  type ReviewFactState,
  type ServiceFeeFact,
} from './checks';
import { isSelfVerificationConfigured } from './self';
import {
  isResidencyServiceFeeConfigured,
  loadResidencyServiceFeePayment,
  resolveResidencyServiceFeeAmount,
} from './service-fee-server';
import {
  issuePermit,
  readPermitIssuanceGate,
  type PermitIssuanceResult,
} from './permit';

/**
 * Assemble the Residency step's records and derive its view.
 *
 * This is the only place the residency page reads the database and the chain.
 * The rules themselves live in `./checks`, so this function is a thin,
 * inspectable mapping: every field it hands to the derivation comes from a
 * record or a receipt re-verification, and none is a fixture.
 *
 * Every read degrades honestly:
 *   - a failed identity/qualified-balance read yields "none recorded", so the
 *     check is shown as pending rather than invented;
 *   - a fee rail that cannot verify yields `unverified`, never `paid`.
 */

export interface ApplicationResidencyRow {
  readonly id: string;
  readonly ref: string | null;
  readonly tier: string | null;
  readonly status: string | null;
  readonly service_tx: string | null;
  readonly service_uid: string | null;
  readonly preapproval_usdc: number | null;
}

export interface ResidencySnapshot {
  readonly applicationId: string;
  readonly applicationRef: string | null;
  readonly tier: string | null;
  readonly status: string | null;
  readonly view: ResidencyView;
  readonly preapprovalPaid: boolean;
  readonly serviceFeeAmountUsdc: number | null;
  /** The recorded pre-approval fee, shown in the service-fee card copy. */
  readonly preapprovalUsdc: number | null;
  /** True when the service-fee rail has a treasury, token and RPC. */
  readonly serviceFeeConfigured: boolean;
  readonly selfConfigured: boolean;
  /** The current issuance outcome; `blocked`/`not-configured` in this build. */
  readonly permit: PermitIssuanceResult;
}

function reviewFromStatus(status: string | null): ReviewFactState {
  if (status === 'approved') return 'cleared';
  if (status === 'blocked') return 'blocked';
  return 'pending';
}

function toIdentityFact(row: {
  over18?: boolean | null;
  not_sanctioned?: boolean | null;
  self_nullifier?: string | null;
  expires_at?: string | null;
}): IdentityFact {
  return {
    over18: row.over18 === true,
    notSanctioned: row.not_sanctioned === true,
    selfNullifier: row.self_nullifier ?? null,
    expiresAt: row.expires_at ?? null,
  };
}

/**
 * The resident's own application, or null when none exists.
 *
 * Throws when the read fails, so a broken read is never mistaken for "no
 * application"; the page treats null as "onboarding not finished".
 */
export async function loadApplicationResidencyRow(
  profileId: string,
): Promise<ApplicationResidencyRow | null> {
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from('applications')
    .select('id, ref, tier, status, service_tx, service_uid, preapproval_usdc')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) {
    throw new Error(`Loading the application failed: ${error.message}`);
  }
  return (data as ApplicationResidencyRow | null) ?? null;
}

async function loadIdentityFact(profileId: string): Promise<IdentityFact | null> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from('identity_attestations')
      .select('over18, not_sanctioned, self_nullifier, expires_at')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return toIdentityFact(
      data as {
        over18: boolean | null;
        not_sanctioned: boolean | null;
        self_nullifier: string | null;
        expires_at: string | null;
      },
    );
  } catch (cause) {
    console.warn(
      '[kade] Could not read identity attestations for residency:',
      cause instanceof Error ? cause.message : cause,
    );
    return null;
  }
}

async function loadQualifiedUsd(applicationId: string): Promise<number | null> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from('container_balances')
      .select('usd_value')
      .eq('application_id', applicationId);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as readonly { usd_value: number | string | null }[];
    return rows.length === 0 ? null : sumQualifiedUsd(rows);
  } catch (cause) {
    console.warn(
      '[kade] Could not read qualified balances for residency:',
      cause instanceof Error ? cause.message : cause,
    );
    return null;
  }
}

/**
 * Build the residency facts for a resident from their records.
 *
 * Exported so a test can drive `deriveResidencyView` with the same facts the
 * page uses without standing up a database.
 */
export async function loadResidencyFacts(
  profileId: string,
  row: ApplicationResidencyRow,
  serviceFeeAmountUsdc: number | null,
): Promise<ResidencyFacts> {
  const [identity, qualifiedUsd, servicePayment] = await Promise.all([
    loadIdentityFact(profileId),
    loadQualifiedUsd(row.id),
    loadResidencyServiceFeePayment(profileId),
  ]);

  const serviceFee: ServiceFeeFact = {
    recorded:
      servicePayment.status === 'paid' || servicePayment.status === 'unverified',
    verified: servicePayment.status === 'paid',
    amountUsdc: serviceFeeAmountUsdc,
  };

  const permit: PermitFact = {
    issued: row.service_uid !== null,
    uid: row.service_uid,
  };

  return {
    tier: row.tier,
    identity,
    qualifiedUsd,
    review: reviewFromStatus(row.status),
    serviceFee,
    permit,
    now: new Date(),
  };
}

/** The complete snapshot the Residency step renders, or null with no application. */
export async function loadResidencySnapshot(
  profileId: string,
): Promise<ResidencySnapshot | null> {
  const row = await loadApplicationResidencyRow(profileId);
  if (!row) return null;

  const mode = readFeeMode();
  let serviceFeeAmountUsdc: number | null = null;
  try {
    serviceFeeAmountUsdc = await resolveResidencyServiceFeeAmount(mode);
  } catch (cause) {
    console.warn(
      '[kade] Could not read the residency service fee:',
      cause instanceof Error ? cause.message : cause,
    );
  }

  const preapproval = await loadFeePayment(profileId);
  const facts = await loadResidencyFacts(profileId, row, serviceFeeAmountUsdc);
  const view = deriveResidencyView(facts, preapproval.status === 'paid');

  return {
    applicationId: row.id,
    applicationRef: row.ref,
    tier: row.tier,
    status: row.status,
    view,
    preapprovalPaid: preapproval.status === 'paid',
    serviceFeeAmountUsdc,
    preapprovalUsdc: row.preapproval_usdc,
    serviceFeeConfigured: isResidencyServiceFeeConfigured(),
    selfConfigured: isSelfVerificationConfigured(),
    permit: issuePermit(readPermitIssuanceGate()),
  };
}
