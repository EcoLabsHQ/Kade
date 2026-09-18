import type { SupabaseClient } from '@supabase/supabase-js';
import {
  COUNTRY_CODES,
  TIER_DATABASE_VALUES,
  tierDatabaseValue,
  type ApplicantProfile,
  type CountryCode,
  type HouseholdMember,
  type Residence,
  type TierIndex,
} from '@kade/shared';
import { assertNoClientSuppliedAmount } from '@/server/fee-authority';

/**
 * The persistence seam for Step 2.
 *
 * The write path is deliberately kept behind this small interface so the UI can
 * be tested with a fake store and so the "Supabase is absent" behaviour is
 * explicit rather than an implicit successful no-op.
 *
 * Tables written (see supabase/migrations):
 *   profiles, profile_citizenships, profile_residences, applications,
 *   household_members.
 *
 * `applications.preapproval_usdc` is never included in a write: the RLS column
 * grant withholds it, and the database recomputes it from `fee_schedule`
 * (contract section 2.1). The snapshot type has no fee field at all.
 */

export type PersistenceMode = 'supabase' | 'not-configured';

export interface OnboardingSnapshot {
  readonly profile: ApplicantProfile;
  readonly citizenships: readonly CountryCode[];
  readonly residences: readonly Residence[];
  readonly tier: TierIndex;
  readonly members: readonly HouseholdMember[];
}

export interface PersistedOnboarding {
  readonly applicationId: string;
  /** Read back from the database; null when it could not be read. */
  readonly preapprovalUsdc: number | null;
}

export interface OnboardingStore {
  readonly mode: PersistenceMode;
  load(userId: string): Promise<OnboardingSnapshot | null>;
  save(
    userId: string,
    snapshot: OnboardingSnapshot,
  ): Promise<PersistedOnboarding>;
}

export const NOT_CONFIGURED_PERSISTENCE_REASON =
  'Supabase is not configured in this environment, so Step 2 changes cannot ' +
  'be saved. The form will not pretend a save succeeded.';

/** Raised when a save is attempted with no configured backing store. */
export class PersistenceNotConfiguredError extends Error {
  constructor(message = NOT_CONFIGURED_PERSISTENCE_REASON) {
    super(message);
    this.name = 'PersistenceNotConfiguredError';
  }
}

function isCountryCode(value: unknown): value is CountryCode {
  return (
    typeof value === 'string' &&
    (COUNTRY_CODES as readonly string[]).includes(value)
  );
}

function tierIndexFromDatabaseValue(value: unknown): TierIndex | null {
  for (const index of [0, 1, 2] as const) {
    if (TIER_DATABASE_VALUES[index].value === value) return index;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Not configured                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The store used when Supabase is absent. `load` is empty and `save` always
 * rejects: it can never report success, so the UI cannot mistake a missing
 * backend for a persisted row.
 */
export function createNotConfiguredOnboardingStore(): OnboardingStore {
  return {
    mode: 'not-configured',
    async load() {
      return null;
    },
    async save() {
      throw new PersistenceNotConfiguredError();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Supabase                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The real write path. `getClient` is called lazily so merely rendering the
 * form never constructs a client.
 */
export function createSupabaseOnboardingStore(
  getClient: () => SupabaseClient,
): OnboardingStore {
  return {
    mode: 'supabase',

    async load(userId: string): Promise<OnboardingSnapshot | null> {
      const client = getClient();

      const profileResult = await client
        .from('profiles')
        .select('first_name, last_name, dob')
        .eq('id', userId)
        .maybeSingle();
      if (profileResult.error) {
        throw new Error(`Loading the profile failed: ${profileResult.error.message}`);
      }
      const profile = profileResult.data as {
        first_name: string | null;
        last_name: string | null;
        dob: string | null;
      } | null;
      if (!profile || profile.dob === null) return null;

      const applicationResult = await client
        .from('applications')
        .select('id, tier')
        .eq('profile_id', userId)
        .maybeSingle();
      if (applicationResult.error) {
        throw new Error(
          `Loading the application failed: ${applicationResult.error.message}`,
        );
      }
      const application = applicationResult.data as {
        id: string;
        tier: string;
      } | null;
      if (!application) return null;
      const tier = tierIndexFromDatabaseValue(application.tier);
      if (tier === null) return null;

      const citizenshipResult = await client
        .from('profile_citizenships')
        .select('country_code')
        .eq('profile_id', userId);
      if (citizenshipResult.error) {
        throw new Error(
          `Loading citizenships failed: ${citizenshipResult.error.message}`,
        );
      }
      const citizenships: CountryCode[] = (citizenshipResult.data ?? [])
        .map((row: { country_code: string }) => row.country_code)
        .filter(isCountryCode);

      const residenceResult = await client
        .from('profile_residences')
        .select('country_code, from_year, to_year')
        .eq('profile_id', userId);
      if (residenceResult.error) {
        throw new Error(
          `Loading residences failed: ${residenceResult.error.message}`,
        );
      }
      const residences: Residence[] = (residenceResult.data ?? [])
        .filter(
          (row: { country_code: string; from_year: number }) =>
            isCountryCode(row.country_code) && Number.isInteger(row.from_year),
        )
        .map(
          (row: {
            country_code: CountryCode;
            from_year: number;
            to_year: number | null;
          }) => ({
            countryCode: row.country_code,
            fromYear: row.from_year,
            toYear:
              row.to_year === null || row.to_year === undefined
                ? 'present'
                : row.to_year,
          }),
        );

      const memberResult = await client
        .from('household_members')
        .select('name, relation, dob, citizenship')
        .eq('application_id', application.id);
      if (memberResult.error) {
        throw new Error(
          `Loading household members failed: ${memberResult.error.message}`,
        );
      }
      const members: HouseholdMember[] = (memberResult.data ?? [])
        .filter(
          (row: {
            name: string | null;
            relation: string | null;
            dob: string | null;
            citizenship: string | null;
          }) =>
            row.name !== null &&
            row.relation !== null &&
            row.dob !== null &&
            isCountryCode(row.citizenship),
        )
        .map(
          (row: {
            name: string;
            relation: string;
            dob: string;
            citizenship: CountryCode;
          }) => ({
            name: row.name,
            relation: row.relation,
            dob: row.dob,
            citizenship: row.citizenship,
          }),
        );

      return {
        profile: {
          firstName: profile.first_name ?? '',
          lastName: profile.last_name ?? '',
          dob: profile.dob,
        },
        citizenships,
        residences,
        tier,
        members,
      };
    },

    async save(
      userId: string,
      snapshot: OnboardingSnapshot,
    ): Promise<PersistedOnboarding> {
      // A browser request may never carry a fee. This throws if a caller
      // smuggled one onto the snapshot (contract section 2.1).
      assertNoClientSuppliedAmount(
        snapshot as unknown as Readonly<Record<string, unknown>>,
      );

      const client = getClient();

      const profileResult = await client.from('profiles').upsert(
        {
          id: userId,
          first_name: snapshot.profile.firstName,
          last_name: snapshot.profile.lastName,
          dob: snapshot.profile.dob,
        },
        { onConflict: 'id' },
      );
      if (profileResult.error) {
        throw new Error(`Saving the profile failed: ${profileResult.error.message}`);
      }

      const deleteCitizenships = await client
        .from('profile_citizenships')
        .delete()
        .eq('profile_id', userId);
      if (deleteCitizenships.error) {
        throw new Error(
          `Clearing citizenships failed: ${deleteCitizenships.error.message}`,
        );
      }
      if (snapshot.citizenships.length > 0) {
        const insertCitizenships = await client
          .from('profile_citizenships')
          .insert(
            snapshot.citizenships.map((countryCode) => ({
              profile_id: userId,
              country_code: countryCode,
            })),
          );
        if (insertCitizenships.error) {
          throw new Error(
            `Saving citizenships failed: ${insertCitizenships.error.message}`,
          );
        }
      }

      const deleteResidences = await client
        .from('profile_residences')
        .delete()
        .eq('profile_id', userId);
      if (deleteResidences.error) {
        throw new Error(
          `Clearing residences failed: ${deleteResidences.error.message}`,
        );
      }
      if (snapshot.residences.length > 0) {
        const insertResidences = await client
          .from('profile_residences')
          .insert(
            snapshot.residences.map((residence) => ({
              profile_id: userId,
              country_code: residence.countryCode,
              from_year: residence.fromYear,
              // A NULL to_year means "current" (20260916000001_profiles.sql).
              to_year: residence.toYear === 'present' ? null : residence.toYear,
            })),
          );
        if (insertResidences.error) {
          throw new Error(
            `Saving residences failed: ${insertResidences.error.message}`,
          );
        }
      }

      // applications: only `tier` (and profile_id on insert) is client-writable.
      const existingResult = await client
        .from('applications')
        .select('id')
        .eq('profile_id', userId)
        .maybeSingle();
      if (existingResult.error) {
        throw new Error(
          `Looking up the application failed: ${existingResult.error.message}`,
        );
      }

      let applicationId: string;
      const existing = existingResult.data as { id: string } | null;
      if (existing) {
        applicationId = existing.id;
        const updateResult = await client
          .from('applications')
          .update({ tier: tierDatabaseValue(snapshot.tier) })
          .eq('id', applicationId);
        if (updateResult.error) {
          throw new Error(
            `Saving the tier failed: ${updateResult.error.message}`,
          );
        }
      } else {
        const insertResult = await client
          .from('applications')
          .insert({
            profile_id: userId,
            tier: tierDatabaseValue(snapshot.tier),
          })
          .select('id')
          .single();
        if (insertResult.error) {
          throw new Error(
            `Creating the application failed: ${insertResult.error.message}`,
          );
        }
        applicationId = (insertResult.data as { id: string }).id;
      }

      const deleteMembers = await client
        .from('household_members')
        .delete()
        .eq('application_id', applicationId);
      if (deleteMembers.error) {
        throw new Error(
          `Clearing household members failed: ${deleteMembers.error.message}`,
        );
      }
      if (snapshot.members.length > 0) {
        const insertMembers = await client.from('household_members').insert(
          snapshot.members.map((member) => ({
            application_id: applicationId,
            name: member.name,
            relation: member.relation,
            dob: member.dob,
            citizenship: member.citizenship,
          })),
        );
        if (insertMembers.error) {
          throw new Error(
            `Saving household members failed: ${insertMembers.error.message}`,
          );
        }
      }

      // Read the server-recomputed fee back. This is display-only; the client
      // never writes it.
      const feeResult = await client
        .from('applications')
        .select('preapproval_usdc')
        .eq('id', applicationId)
        .maybeSingle();
      const feeRow = feeResult.error
        ? null
        : (feeResult.data as { preapproval_usdc: number | null } | null);

      return {
        applicationId,
        preapprovalUsdc:
          feeRow && feeRow.preapproval_usdc !== null
            ? Number(feeRow.preapproval_usdc)
            : null,
      };
    },
  };
}

/**
 * The store the browser uses to save.
 *
 * `save` delegates to a server action, so no write is shaped or issued by the
 * browser. `load` is served by the server-rendered page (`lib/onboarding/server.ts`),
 * so this side has nothing to read.
 *
 * Kept behind the same `OnboardingStore` interface as the other stores so the
 * wizard can still be tested with a fake.
 */
export function createServerActionOnboardingStore(): OnboardingStore {
  return {
    mode: 'supabase',
    async load() {
      return null;
    },
    async save(_userId: string, snapshot: OnboardingSnapshot) {
      const { saveOnboardingStep2 } = await import('@/app/onboarding/actions');
      return saveOnboardingStep2(snapshot);
    },
  };
}

/** Chooses the store for a persistence mode. */
export function createOnboardingStore(
  mode: PersistenceMode,
  getClient?: () => SupabaseClient,
): OnboardingStore {
  if (mode !== 'supabase') return createNotConfiguredOnboardingStore();
  // `getClient` is retained for the server-side restore path; the browser save
  // always goes through the action.
  return getClient
    ? createSupabaseOnboardingStore(getClient)
    : createServerActionOnboardingStore();
}
