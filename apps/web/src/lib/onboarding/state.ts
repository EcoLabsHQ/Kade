import {
  GENDER_VALUES,
  RELATION_VALUES,
  stepOneComplete,
  stepTwoComplete,
} from '@kade/shared';
import { readFeeMode } from '@/lib/env';
import { loadOnboardingSnapshot } from './server';
import type { OnboardingSnapshot } from './persistence';

/**
 * `stepOneComplete`/`stepTwoComplete` are the write-validation authority: a new
 * submission must carry a gender and one of the three accepted relations. Both
 * rules were added after residents had already finished onboarding (migration
 * `20261005000001_gender_and_relation.sql` and the matching shared contract),
 * and a stored NULL is never back-filled. Applying the write schema to a stored
 * row would therefore report a finished resident as unfinished and send them
 * back through the flow — the reported defect ("if it is already done, take me
 * to the overview").
 *
 * Completeness is not write validation: it asks whether the resident finished
 * the steps, and a legacy-only gap must not block that. These placeholders are
 * used for this check alone; they never leave this module and are never
 * persisted. A value that is *present but invalid* still blocks, so the rule is
 * not weakened for new data.
 */
const LEGACY_GENDER = GENDER_VALUES[0];
const LEGACY_RELATION = RELATION_VALUES[0];

function isKnownRelation(value: string): boolean {
  return (RELATION_VALUES as readonly string[]).includes(value);
}

/** A stored NULL gender (the legacy read maps it to `''`) is satisfied. */
function genderForCompleteness(value: string): string {
  return value === '' ? LEGACY_GENDER : value;
}

/**
 * A relation outside the current enum is free text from the older form. It is
 * satisfied for completeness, exactly as an absent gender is; the form still
 * flags it for re-selection on a replay. An empty relation is left untouched and
 * blocks.
 */
function relationForCompleteness(value: string): string {
  if (value === '' || isKnownRelation(value)) return value;
  return LEGACY_RELATION;
}

/**
 * The snapshot as completeness sees it. Only the legacy representations of a
 * field whose rule changed are masked: an absent gender and a relation outside
 * the current enum. Everything else is validated by the shared schemas
 * unchanged.
 */
function satisfyLegacyFields(snapshot: OnboardingSnapshot): OnboardingSnapshot {
  return {
    ...snapshot,
    profile: {
      ...snapshot.profile,
      gender: genderForCompleteness(snapshot.profile.gender),
    },
    members: snapshot.members.map((member) => ({
      ...member,
      relation: relationForCompleteness(member.relation),
      gender: genderForCompleteness(member.gender),
    })),
  };
}

/**
 * Whether a snapshot satisfies both Week 1 onboarding steps.
 *
 * The shared contract owns the rules; this only asks it, on a view where a
 * legacy-only gap does not block (see `satisfyLegacyFields`). Step 1 covers the
 * applicant, citizenships and the five-year residence history; step 2 covers the
 * tier and the household. The fee mode is a server setting, never client input.
 */
function isComplete(snapshot: OnboardingSnapshot | null): boolean {
  if (!snapshot) return false;

  const view = satisfyLegacyFields(snapshot);

  const stepOne = stepOneComplete({
    applicant: view.profile,
    citizenships: view.citizenships,
    residences: view.residences,
  });
  if (!stepOne.complete) return false;

  const stepTwo = stepTwoComplete({
    mode: readFeeMode(),
    tier: view.tier,
    members: view.members,
  });
  return stepTwo.complete;
}

/**
 * Where a signed-in resident should land.
 *
 * Spec section 8: an incomplete onboarding goes to the first pending step; a
 * completed one goes to the account. Week 1 has two steps, so the only split
 * that exists is "complete or not".
 *
 * A read failure is treated as incomplete. Sending someone back to a setup
 * screen they have already finished is recoverable; sending them to a dashboard
 * built on data we could not read is not.
 */
export async function postLoginPath(userId: string): Promise<string> {
  try {
    return isComplete(await loadOnboardingSnapshot(userId))
      ? '/'
      : '/onboarding';
  } catch {
    return '/onboarding';
  }
}

/**
 * Gates the dashboard: an authenticated session alone does not entitle a
 * resident to account screens built on onboarding data that does not exist yet.
 */
export async function hasCompletedOnboarding(userId: string): Promise<boolean> {
  try {
    return isComplete(await loadOnboardingSnapshot(userId));
  } catch {
    return false;
  }
}
