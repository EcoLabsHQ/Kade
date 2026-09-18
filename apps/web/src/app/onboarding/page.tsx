import { redirect } from 'next/navigation';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { chainsForEnv } from '@kade/shared';
import { getSessionUser } from '@/lib/supabase/server';
import { isAuthConfigured, readAuthEnv, readChainEnv, readFeeMode } from '@/lib/env';
import { loadOnboardingSnapshot } from '@/lib/onboarding/server';
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

  return (
    <OnboardingFlow
      userId={session.userId}
      mode={feeMode}
      persistence={configured ? 'supabase' : 'not-configured'}
      initial={initial}
      network={activeNetworkLabel()}
      accountState={{ kind: 'pending' }}
    />
  );
}
