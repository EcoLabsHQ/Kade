import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { InvestScreen } from '@/components/invest/InvestScreen';
import { getSessionUser } from '@/lib/supabase/server';
import { loadShellSafe } from '@/lib/safe/shell';
import { readChainEnv } from '@/lib/env';
import { loadReviewBar } from '@/lib/review/review-bar';
import {
  isMorphoConfigured,
  morphoChainId,
  morphoChainName,
  readMorphoPoolConfig,
} from '@/lib/invest/morpho-config';

export const dynamic = 'force-dynamic';

/**
 * The Invest route (D18 / EXE-014).
 *
 * Resolves the resident's Safe and the server-only Morpho configuration and
 * renders the screen. The pool address, chain and market id are passed to the
 * client as values, so the browser neither reads nor hard-codes them.
 *
 * Execution state is resolved honestly: `mainnetConfigured` is false while no
 * mainnet RPC/payer is supplied, and `signerDeployed` follows the Safe record.
 * Both being false is why the screen can only build, never send.
 */
export default async function InvestPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect('/login');
  }

  const shellSafe = await loadShellSafe(session.userId);
  // `readMorphoPoolConfig` returns null (never throws) when configuration is
  // absent or malformed, so a misconfigured environment degrades rather than
  // taking the route down.
  const config = readMorphoPoolConfig();
  const reviewBar = await loadReviewBar(session.userId);

  return (
    <AppShell
      email={session.email}
      safeAddress={shellSafe.address}
      safeDeployed={shellSafe.deployed}
      safeStatus={shellSafe.status}
      explorerUrl={shellSafe.explorerUrl}
      showReviewBar={reviewBar.show}
      reviewReference={reviewBar.reference}
        isReviewer={reviewBar.isReviewer}
    >
      <ContentContainer>
        <InvestScreen
          pool={{
            configured: isMorphoConfigured(),
            chainId: morphoChainId(),
            chainName: morphoChainName(),
            loanToken: config?.marketParams.loanToken ?? null,
            morpho: config?.morpho ?? null,
            marketId: config?.marketId ?? null,
          }}
          safeAddress={shellSafe.address}
          safeDeployed={shellSafe.deployed}
          mainnetConfigured={isMainnetRailConfigured()}
          signerDeployed={shellSafe.deployed}
        />
      </ContentContainer>
    </AppShell>
  );
}

/**
 * Whether the mainnet rail (RPC/payer) is configured.
 *
 * False in every environment today: mainnet funding is not supplied (contract
 * §5), so the deposit cannot be submitted. Read from `KADE_CHAIN_ENV` and the
 * reserved `ETHEREUM_RPC_URL`, so the screen is honest rather than assuming
 * mainnet is live.
 */
function isMainnetRailConfigured(): boolean {
  return readChainEnv() === 'mainnet' && Boolean(process.env.ETHEREUM_RPC_URL?.trim());
}
