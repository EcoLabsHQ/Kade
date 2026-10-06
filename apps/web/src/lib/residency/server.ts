import { createSupabaseServerClient } from '@/lib/supabase/server';
import { readFeeMode } from '@/lib/env';
import type { FeePaymentState } from '@/lib/payments/preapproval-fee';
import { loadFeePayment } from '@/lib/payments/server';
import { loadShellSafe, type ShellSafe } from '@/lib/safe/shell';
import {
  summarizeQualifiedPosition,
  type QualifiedPosition,
} from '@/lib/wealth/qualified-position';
import { loadVaultHoldings } from '@/lib/wealth/vault-holdings';
import {
  deriveResidencyView,
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
  status?: string | null;
  verified_at?: string | null;
  self_nullifier?: string | null;
}): IdentityFact | null {
  if (row.status !== 'valid' && row.status !== 'invalid') return null;
  return {
    provider: 'self',
    status: row.status,
    verifiedAt: row.verified_at ?? null,
    selfNullifier: row.self_nullifier ?? null,
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

/**
 * The resident's Self identity outcome, or null when none is recorded.
 *
 * Exported so the Overview tracker can read the **same** `self_verifications`
 * record the Residency step reads, rather than inventing an identity state. A
 * failed read degrades to null (the same "not started" the Residency step
 * shows), so absence is never presented as a verification.
 */
export async function loadIdentityFact(profileId: string): Promise<IdentityFact | null> {
  try {
    const client = await createSupabaseServerClient();
    const { data, error } = await client
      .from('self_verifications')
      .select('status, verified_at, self_nullifier')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return toIdentityFact(
      data as {
        status: string | null;
        verified_at: string | null;
        self_nullifier: string | null;
      },
    );
  } catch (cause) {
    console.warn(
      '[kade] Could not read Self verifications for residency:',
      cause instanceof Error ? cause.message : cause,
    );
    return null;
  }
}

/**
 * The Safe's qualified position, read **from the chain** and reduced to the one
 * total.
 *
 * `container_balances` has no writer, so a read of it always returned nothing
 * while the Safe visibly held assets. The Safe's real on-chain position is the
 * same read the Holdings `QUALIFIED` card uses (`loadVaultHoldings`), reduced by
 * the same function (`summarizeQualifiedPosition`), so the card and the tier
 * check cannot disagree. Nothing is persisted and no refresh step is involved:
 * the moment an asset is in the vault it counts.
 */
async function loadQualifiedPosition(
  profileId: string,
  shellSafe?: ShellSafe,
): Promise<QualifiedPosition> {
  try {
    // The page already resolves the shell Safe for its own chrome, so it is
    // passed in and reused rather than read a second time here. Callers that
    // have no Safe in hand still resolve it, keeping this read self-contained.
    const safe = shellSafe ?? (await loadShellSafe(profileId));
    const rows = await loadVaultHoldings(safe.address);
    return summarizeQualifiedPosition({ safeAddress: safe.address, rows });
  } catch (cause) {
    // A throw is still an unknown position with its reason, never a `$0`.
    console.warn(
      '[kade] Could not read the qualified position for residency:',
      cause instanceof Error ? cause.message : cause,
    );
    return {
      status: 'unknown',
      reason:
        cause instanceof Error
          ? `The qualified position could not be read: ${cause.message}`
          : 'The qualified position could not be read.',
    };
  }
}

/**
 * The already-read values a {@link ResidencyFacts} is assembled from.
 *
 * `servicePayment` accepts the explicit `unread` sentinel in addition to the
 * rail's own states, so a failed service-fee read is mapped to "not recorded /
 * not verified" rather than throwing or pretending a payment exists.
 */
export interface ResidencyFactInputs {
  readonly tier: string | null;
  readonly status: string | null;
  readonly identity: IdentityFact | null;
  readonly qualified: QualifiedPosition;
  readonly servicePayment: FeePaymentState | { readonly status: 'unread' };
  readonly serviceFeeAmountUsdc: number | null;
  readonly serviceUid: string | null;
}

/**
 * Assemble the residency facts from values that have already been read.
 *
 * Pure and exported so a second surface (the Overview tracker) can reduce the
 * **same** records with the same `deriveResidencyView` without a duplicate
 * database or chain read. This is the single mapping `loadResidencyFacts` uses,
 * so the two surfaces cannot drift.
 */
export function residencyFactsFrom(input: ResidencyFactInputs): ResidencyFacts {
  const serviceFee: ServiceFeeFact = {
    recorded:
      input.servicePayment.status === 'paid' ||
      input.servicePayment.status === 'unverified',
    verified: input.servicePayment.status === 'paid',
    amountUsdc: input.serviceFeeAmountUsdc,
  };

  const permit: PermitFact = {
    issued: input.serviceUid !== null,
    uid: input.serviceUid,
  };

  return {
    tier: input.tier,
    identity: input.identity,
    qualified: input.qualified,
    review: reviewFromStatus(input.status),
    serviceFee,
    permit,
  };
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
  shellSafe?: ShellSafe,
): Promise<ResidencyFacts> {
  const [identity, qualified, servicePayment] = await Promise.all([
    loadIdentityFact(profileId),
    loadQualifiedPosition(profileId, shellSafe),
    loadResidencyServiceFeePayment(profileId),
  ]);

  return residencyFactsFrom({
    tier: row.tier,
    status: row.status,
    identity,
    qualified,
    servicePayment,
    serviceFeeAmountUsdc,
    serviceUid: row.service_uid,
  });
}

/**
 * The complete snapshot the Residency step renders, or null with no application.
 *
 * The shell Safe is an optional input: the page resolves it once for its own
 * chrome and passes it here so the qualified-position read reuses it instead of
 * reading the deployment record a second time. Omit it and the snapshot resolves
 * it itself, so the returned shape and its meaning are unchanged either way.
 */
export async function loadResidencySnapshot(
  profileId: string,
  shellSafe?: ShellSafe,
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
  const facts = await loadResidencyFacts(
    profileId,
    row,
    serviceFeeAmountUsdc,
    shellSafe,
  );
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
