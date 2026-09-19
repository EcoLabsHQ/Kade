import { redirect } from 'next/navigation';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { chainsForEnv } from '@kade/shared';
import { getSessionUser } from '@/lib/supabase/server';
import { isAuthConfigured, readAuthEnv, readChainEnv, readFeeMode } from '@/lib/env';
import { loadOnboardingSnapshot } from '@/lib/onboarding/server';
import { resolvePreapprovalFeeBreakdown } from '@/lib/onboarding/fee-server';
import type { PreapprovalFeeBreakdown } from '@/lib/onboarding/fee';
import type { OnboardingSnapshot } from '@/lib/onboarding/persistence';

export const dynamic = 'force-dynamic';

/** The chain the flow is actually running on: Sepolia while testing. */
function activeNetworkLabel(): string {
  const chains = chainsForEnv(readChainEnv());
  const ethereum = chains.find((chain) => chain.key === 'ethereum') ?? chains[0];
  return ethereum?.name ?? 'Ethereum Sepolia';
}

export default async function OnboardingPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const configured = isAuthConfigured(readAuthEnv());
  const feeMode = readFeeMode();

  let initial: OnboardingSnapshot | null = null;
  if (configured) {
    try {
      initial = await loadOnboardingSnapshot(session.userId);
    } catch (cause) {
      // A failed restore must not be mistaken for "no saved data".
      console.warn(
        '[kade] Could not restore the onboarding draft:',
        cause instanceof Error ? cause.message : cause,
      );
    }
  }

  // The fee is the database's, resolved from the active `fee_schedule` for the
  // restored household (or the applicant alone when nothing is saved yet). A
  // failed read yields null, so the screen says the fee is unavailable rather
  // than fabricating one. The client asks the server again as the household
  // changes; this value only avoids a flash on first paint.
  let initialFee: PreapprovalFeeBreakdown | null = null;
  if (configured) {
    try {
      initialFee = await resolvePreapprovalFeeBreakdown(
        feeMode,
        initial ? 1 + initial.members.length : 1,
      );
    } catch (cause) {
      console.warn(
        '[kade] Could not read the configured pre-approval fee:',
        cause instanceof Error ? cause.message : cause,
      );
    }
  }

  return (
    <OnboardingFlow
      userId={session.userId}
      mode={feeMode}
      persistence={configured ? 'supabase' : 'not-configured'}
      initial={initial}
      initialFee={initialFee}
      network={activeNetworkLabel()}
      accountState={{ kind: 'pending' }}
    />
  );
}
