import type { SupabaseClient } from '@supabase/supabase-js';
import {
  COUNTRY_CODES,
  TIER_DATABASE_VALUES,
  type ApplicantProfile,
  type CountryCode,
  type HouseholdMember,
  type Residence,
  type TierIndex,
} from '@kade/shared';

/**
 * The read side of the persistence seam for Step 2.
 *
 * The live write path is `save_onboarding_step2`, invoked from
 * `@/app/onboarding/actions` and consumed by `OnboardingWizard`. That RPC is
 * the only writer: `applications.preapproval_usdc` is never sent from the
 * client, the RLS column grant withholds it, and the database recomputes it
 * from `fee_schedule` (contract section 2.1). The snapshot type has no fee
 * field at all, so there is nothing for a client-supplied fee guard to protect
 * on this path.
 *
 * What remains here is the server-side restore: `load` reads the tables the
 * form repopulates from. `save_onboarding_step2` owns the write transaction
 * (profile, citizenships, residences, application, household members).
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

/**
 * The seam the UI consumes. `save` is a real write for the configured store
 * (the server action) and always rejects for the unconfigured one, so the UI
 * can never mistake a missing backend for a persisted row.
 */
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
 * The server-side restore reader. `getClient` is called lazily so merely
 * rendering the form never constructs a client.
 *
 * The returned store's `save` rejects: writes do not live here. The live write
 * path is the `save_onboarding_step2` RPC in `@/app/onboarding/actions`, which
 * the wizard invokes directly. Keeping a second, unreachable writer here would
 * mean the write boundary the app actually uses is not the one under test.
 */
export function createSupabaseOnboardingStore(
  getClient: () => SupabaseClient,
): OnboardingStore {
  return {
    mode: 'supabase',

    async save(): Promise<PersistedOnboarding> {
      throw new Error(
        'Writes go through save_onboarding_step2, not this read store.',
      );
    },

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
  };
}

