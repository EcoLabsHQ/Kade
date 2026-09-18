import { stepOneComplete, stepTwoComplete } from '@kade/shared';
import { readFeeMode } from '@/lib/env';
import { loadOnboardingSnapshot } from './server';
import type { OnboardingSnapshot } from './persistence';

/**
 * Whether a snapshot satisfies both Week 1 onboarding steps.
 *
 * The shared contract owns the rules; this only asks it. Step 1 covers the
 * applicant, citizenships and the five-year residence history; step 2 covers the
 * tier and the household. The fee mode is a server setting, never client input.
 */
function isComplete(snapshot: OnboardingSnapshot | null): boolean {
  if (!snapshot) return false;

  const stepOne = stepOneComplete({
    applicant: snapshot.profile,
    citizenships: snapshot.citizenships,
    residences: snapshot.residences,
  });
  if (!stepOne.complete) return false;

  const stepTwo = stepTwoComplete({
    mode: readFeeMode(),
    tier: snapshot.tier,
    members: snapshot.members,
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
