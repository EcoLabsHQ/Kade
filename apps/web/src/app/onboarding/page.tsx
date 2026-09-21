import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';
import { WalletProvider } from '@/components/wallet/WalletProvider';
import { CHAIN_IDS, chainByChainId, chainsForEnv } from '@kade/shared';
import { getSessionUser } from '@/lib/supabase/server';
import {
  isAuthConfigured,
  readAuthEnv,
  readChainEnv,
  readFeeMode,
  readTreasuryAddress,
  readWalletConnectProjectId,
} from '@/lib/env';
import { isFeePaymentConfigured, loadFeePayment } from '@/lib/payments/server';
import { loadPasskeyCredential } from '@/app/account/passkey-actions';
import { listBitcoinAddresses } from '@/app/onboarding/wealth-actions';
import { listWalletAddresses } from '@/app/onboarding/wallet-actions';
import { loadOnboardingSnapshot } from '@/lib/onboarding/server';
import { resolvePreapprovalFeeBreakdown } from '@/lib/onboarding/fee-server';
import type { PreapprovalFeeBreakdown } from '@/lib/onboarding/fee';
import type { FeePaymentState } from '@/lib/payments/preapproval-fee';
import type { OnboardingSnapshot } from '@/lib/onboarding/persistence';
import type { BitcoinAddressRecord, EvmAddressRecord } from '@/lib/wealth/types';

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

  // D3: a resident who already created a passkey must be recognised from what
  // was persisted, not asked to create a second one. A failed read is treated
  // as "none known" so it degrades to the create state rather than blocking.
  let initialCredentialId: string | null = null;
  if (configured) {
    try {
      const stored = await loadPasskeyCredential();
      initialCredentialId = stored?.credentialId ?? null;
    } catch (cause) {
      console.warn(
        '[kade] Could not load the stored passkey credential:',
        cause instanceof Error ? cause.message : cause,
      );
    }
  }

  // Bitcoin watch-only addresses, read server-side so the Proof-of-wealth
  // screen shows current balances on first paint. A failed, unconfigured or
  // unauthenticated read degrades to none rather than fabricating an address.
  let initialBitcoinAddresses: readonly BitcoinAddressRecord[] = [];
  if (configured) {
    try {
      initialBitcoinAddresses = await listBitcoinAddresses();
    } catch (cause) {
      console.warn(
        '[kade] Could not load the saved Bitcoin addresses:',
        cause instanceof Error ? cause.message : cause,
      );
    }
  }

  // Pasted EVM addresses, read server-side for the same reason. A failed,
  // unconfigured or unauthenticated read degrades to none rather than
  // fabricating an address.
  let initialEvmAddresses: readonly EvmAddressRecord[] = [];
  if (configured) {
    try {
      initialEvmAddresses = await listWalletAddresses();
    } catch (cause) {
      console.warn(
        '[kade] Could not load the saved EVM addresses:',
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

  // The pre-approval fee payment state, re-derived from the recorded hash and
  // the Sepolia receipt. A failed read degrades to "nothing recorded" so the
  // step offers the payment rather than claiming it already happened.
  let initialPayment: FeePaymentState = { status: 'none' };
  if (configured) {
    try {
      initialPayment = await loadFeePayment(session.userId);
    } catch (cause) {
      console.warn(
        '[kade] Could not load the pre-approval fee payment:',
        cause instanceof Error ? cause.message : cause,
      );
    }
  }

  // The wallet modal and the fee rail are both configuration. The rail's own
  // check includes the RPC verifier, so a missing SEPOLIA_RPC_URL disables the
  // payment rather than letting a resident send funds the server cannot verify.
  const treasuryAddress = readTreasuryAddress();
  const walletConfigured = readWalletConnectProjectId() !== null;
  const paymentConfigured = walletConfigured && isFeePaymentConfigured();
  const sepolia = chainByChainId(CHAIN_IDS.sepolia);
  const usdcAddress = sepolia?.usdcAddress.value ?? '';
  const explorerUrl = sepolia?.explorerUrl ?? 'https://sepolia.etherscan.io';

  const cookieHeader = (await headers()).get('cookie');

  return (
    <WalletProvider cookies={cookieHeader}>
      <OnboardingFlow
        userId={session.userId}
        mode={feeMode}
        persistence={configured ? 'supabase' : 'not-configured'}
        initial={initial}
        initialFee={initialFee}
        initialCredentialId={initialCredentialId}
        initialBitcoinAddresses={initialBitcoinAddresses}
        initialEvmAddresses={initialEvmAddresses}
        initialPayment={initialPayment}
        paymentConfigured={paymentConfigured}
        treasuryAddress={treasuryAddress}
        usdcAddress={usdcAddress}
        explorerUrl={explorerUrl}
        network={activeNetworkLabel()}
        accountState={{ kind: 'pending' }}
      />
    </WalletProvider>
  );
}
