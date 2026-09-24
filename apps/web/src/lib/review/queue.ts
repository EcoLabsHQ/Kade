import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isReviewAction,
  type ReviewAction,
} from './attestation';
import type {
  ApplicationStatus,
  ReviewApplicant,
  ReviewApplication,
  ReviewEvent,
  ReviewIdentity,
  ReviewQueueItem,
  ReviewResidence,
  ReviewWallet,
} from './decision';

/**
 * Read the reviewer's queue.
 *
 * RLS is the gate: these queries run as the signed-in user, so a non-reviewer
 * sees nothing (the reviewer policies in 20260922000060_admin_review.sql are the
 * only thing that lets the rows through). The loader does not re-implement the
 * authorization decision, and it never uses a service-role key.
 *
 * The queue is assembled from the tables D19 names: `applications` + `profiles`
 * for the applicant, `wallets` for proof of wealth, `self_verifications` (the
 * real identity outcome, contract v1.7), `profile_residences` and
 * `profile_citizenships` for the residency checks, and `review_events` for the
 * latest action.
 */

interface ApplicationRow {
  readonly id: string;
  readonly ref: string | null;
  readonly tier: string;
  readonly status: ApplicationStatus;
  readonly preapproval_usdc: number | string | null;
  readonly service_usdc: number | string | null;
  readonly fee_tx: string | null;
  readonly review_uid: string | null;
  readonly service_uid: string | null;
  readonly profile_id: string;
  readonly profiles:
    | {
        readonly id: string;
        readonly first_name: string | null;
        readonly last_name: string | null;
        readonly email: string | null;
      }
    | readonly {
        readonly id: string;
        readonly first_name: string | null;
        readonly last_name: string | null;
        readonly email: string | null;
      }[]
    | null;
}

interface WalletRow {
  readonly profile_id: string;
  readonly address: string;
  readonly chain: number;
  readonly provider: string | null;
  readonly verified_at: string | null;
}

interface SelfVerificationRow {
  readonly profile_id: string;
  readonly provider: string | null;
  readonly status: string | null;
  readonly verified_at: string | null;
  readonly self_nullifier: string | null;
}

interface ResidenceRow {
  readonly profile_id: string;
  readonly country_code: string;
  readonly from_year: number;
  readonly to_year: number | null;
}

interface CitizenshipRow {
  readonly profile_id: string;
  readonly country_code: string;
}

interface ReviewEventRow {
  readonly application_id: string;
  readonly action: string;
  readonly note: string | null;
  readonly attestation_uid: string | null;
  readonly created_at: string;
}

function toNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function embeddedProfile(row: ApplicationRow): ReviewApplicant {
  const embedded = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: embedded?.id ?? row.profile_id,
    firstName: embedded?.first_name ?? null,
    lastName: embedded?.last_name ?? null,
    email: embedded?.email ?? null,
  };
}

function toApplication(row: ApplicationRow): ReviewApplication {
  return {
    id: row.id,
    ref: row.ref,
    tier: row.tier,
    status: row.status,
    preapprovalUsdc: toNumber(row.preapproval_usdc),
    serviceUsdc: toNumber(row.service_usdc),
    feeTx: row.fee_tx,
    reviewUid: row.review_uid,
    serviceUid: row.service_uid,
  };
}

function groupBy<T, K extends string>(
  rows: readonly T[],
  key: (row: T) => K,
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** The resident's own review state, for the live gate. RLS scopes the read. */
export interface ResidentReviewState {
  readonly status: ApplicationStatus | null;
  readonly latestReview: ReviewEvent | null;
}

export async function loadResidentReviewState(
  client: SupabaseClient,
  profileId: string,
): Promise<ResidentReviewState> {
  const { data: application, error } = await client
    .from('applications')
    .select('id, status')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) {
    throw new Error(`Loading the application state failed: ${error.message}`);
  }
  if (!application) return { status: null, latestReview: null };

  const { data: events, error: eventsError } = await client
    .from('review_events')
    .select('application_id, action, note, attestation_uid, created_at')
    .eq('application_id', (application as { id: string }).id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (eventsError) {
    throw new Error(`Loading the latest review failed: ${eventsError.message}`);
  }

  const latest = (events as unknown as ReviewEventRow[] | null)?.[0] ?? null;
  return {
    status: (application as { status: ApplicationStatus }).status,
    latestReview:
      latest && isReviewAction(latest.action)
        ? {
            action: latest.action as ReviewAction,
            note: latest.note,
            attestationUid: latest.attestation_uid,
            createdAt: latest.created_at,
          }
        : null,
  };
}

export async function loadReviewQueue(
  client: SupabaseClient,
): Promise<readonly ReviewQueueItem[]> {
  const { data: applicationRows, error } = await client
    .from('applications')
    .select(
      'id, ref, tier, status, preapproval_usdc, service_usdc, fee_tx, ' +
        'review_uid, service_uid, profile_id, ' +
        'profiles (id, first_name, last_name, email)',
    )
    .order('ref', { ascending: true, nullsFirst: false });
  if (error) {
    throw new Error(`Loading the review queue failed: ${error.message}`);
  }

  const applications = (applicationRows as unknown as ApplicationRow[] | null) ?? [];
  if (applications.length === 0) return [];

  const profileIds = [...new Set(applications.map((row) => row.profile_id))];
  const applicationIds = applications.map((row) => row.id);

  const [wallets, identities, residences, citizenships, events] = await Promise.all([
    client.from('wallets').select('profile_id, address, chain, provider, verified_at').in('profile_id', profileIds),
    // The identity outcome and disclosed facts now live in `self_verifications`:
    // Self verifies the proof in backend (off-chain) mode and Kade stores the
    // outcome plus the facts. The reviewer policy on the table is what lets
    // these rows through.
    client
      .from('self_verifications')
      .select('profile_id, provider, status, verified_at, self_nullifier')
      .in('profile_id', profileIds)
      .order('created_at', { ascending: false }),
    client
      .from('profile_residences')
      .select('profile_id, country_code, from_year, to_year')
      .in('profile_id', profileIds),
    client
      .from('profile_citizenships')
      .select('profile_id, country_code')
      .in('profile_id', profileIds),
    client
      .from('review_events')
      .select('application_id, action, note, attestation_uid, created_at')
      .in('application_id', applicationIds)
      .order('created_at', { ascending: false }),
  ]);

  const firstError =
    wallets.error ??
    identities.error ??
    residences.error ??
    citizenships.error ??
    events.error;
  if (firstError) {
    throw new Error(`Loading the review queue detail failed: ${firstError.message}`);
  }

  const walletsByProfile = groupBy(
    (wallets.data as unknown as WalletRow[] | null) ?? [],
    (row) => row.profile_id,
  );
  const identitiesByProfile = groupBy(
    (identities.data as unknown as SelfVerificationRow[] | null) ?? [],
    (row) => row.profile_id,
  );
  const residencesByProfile = groupBy(
    (residences.data as unknown as ResidenceRow[] | null) ?? [],
    (row) => row.profile_id,
  );
  const citizenshipsByProfile = groupBy(
    (citizenships.data as unknown as CitizenshipRow[] | null) ?? [],
    (row) => row.profile_id,
  );
  const eventsByApplication = groupBy(
    (events.data as unknown as ReviewEventRow[] | null) ?? [],
    (row) => row.application_id,
  );

  return applications.map((row) => {
    const identityRow = identitiesByProfile.get(row.profile_id)?.[0];
    const identity: ReviewIdentity | null =
      identityRow && (identityRow.status === 'valid' || identityRow.status === 'invalid')
        ? {
            provider: 'self',
            status: identityRow.status,
            verifiedAt: identityRow.verified_at,
            selfNullifier: identityRow.self_nullifier,
          }
        : null;

    const latestEvent = eventsByApplication.get(row.id)?.[0];
    const latestReview: ReviewEvent | null =
      latestEvent && isReviewAction(latestEvent.action)
        ? {
            action: latestEvent.action as ReviewAction,
            note: latestEvent.note,
            attestationUid: latestEvent.attestation_uid,
            createdAt: latestEvent.created_at,
          }
        : null;

    return {
      application: toApplication(row),
      applicant: embeddedProfile(row),
      wallets: (walletsByProfile.get(row.profile_id) ?? []).map(
        (wallet): ReviewWallet => ({
          address: wallet.address,
          chain: wallet.chain,
          provider: wallet.provider,
          verifiedAt: wallet.verified_at,
        }),
      ),
      identity,
      residences: (residencesByProfile.get(row.profile_id) ?? []).map(
        (residence): ReviewResidence => ({
          countryCode: residence.country_code,
          fromYear: residence.from_year,
          toYear: residence.to_year,
        }),
      ),
      citizenships: (citizenshipsByProfile.get(row.profile_id) ?? []).map(
        (citizenship) => citizenship.country_code,
      ),
      latestReview,
    };
  });
}
