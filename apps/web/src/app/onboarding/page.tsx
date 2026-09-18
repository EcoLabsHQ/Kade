import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard';
import type { StepperItem } from '@/components/onboarding/PreRegistrationStepper';
import { getSessionUser } from '@/lib/supabase/server';
import { isAuthConfigured, readAuthEnv, readFeeMode } from '@/lib/env';
import { loadOnboardingSnapshot } from '@/lib/onboarding/server';
import type { OnboardingSnapshot } from '@/lib/onboarding/persistence';

export const dynamic = 'force-dynamic';

/**
 * The pre-registration stepper. Step 1 (account creation) is satisfied by the
 * authenticated Google session; Step 2 is this screen. Steps 3–4 are Week 1
 * exclusions (contract section 9), so they are shown locked rather than hidden.
 */
const PRE_REGISTRATION_STEPS: readonly StepperItem[] = [
  { title: 'Create account', state: 'done' },
  { title: 'Profile & household', state: 'active' },
  {
    title: 'Proof of wealth',
    state: 'locked',
    lockReason:
      'Proof of wealth is out of Week 1 scope (contract section 9).',
  },
  {
    title: 'Pay pre-approval fee',
    state: 'locked',
    lockReason:
      'Pre-approval payment execution is out of Week 1 scope (contract section 9).',
  },
];

export default async function OnboardingPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const configured = isAuthConfigured(readAuthEnv());

  // The active fee mode is a server-side configuration switch, passed down as a
  // prop. The client can display the amount but cannot select or override it.
  const feeMode = readFeeMode();

  let initial: OnboardingSnapshot | null = null;
  if (configured) {
    try {
      initial = await loadOnboardingSnapshot(session.userId);
    } catch (cause) {
      // A failed restore must not be mistaken for "no saved data". The wizard
      // still starts empty and will not save until the applicant asks it to.
      console.warn(
        '[kade] Could not restore the onboarding draft:',
        cause instanceof Error ? cause.message : cause,
      );
    }
  }

  return (
    <AppShell email={session.email} stepper={PRE_REGISTRATION_STEPS}>
      <ContentContainer>
        <OnboardingWizard
          mode={feeMode}
          userId={session.userId}
          persistence={configured ? 'supabase' : 'not-configured'}
          initial={initial}
        />
      </ContentContainer>
    </AppShell>
  );
}
