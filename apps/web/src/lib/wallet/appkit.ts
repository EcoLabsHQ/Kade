import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { sepolia } from '@reown/appkit/networks';
import type { AppKitNetwork } from '@reown/appkit/networks';

/**
 * Reown AppKit configuration for the pre-approval fee payment (contract 8.9).
 *
 * The wallet connection exists only to pay the fee: the resident connects a
 * browser wallet or WalletConnect and sends USDC to the Kade treasury on
 * Sepolia. It is not a login and confers no authority over the resident Safe.
 *
 * Everything here is client-side. The treasury address and the amount stay on
 * the server and are passed to the payment screen as props.
 */

/** Iteration 1 pays on Ethereum Sepolia only (contract v1.9). */
export const WALLET_NETWORKS: [AppKitNetwork, ...AppKitNetwork[]] = [sepolia];

/** The project id, or null when the environment has not configured one. */
export const walletProjectId: string | null =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() || null;

/**
 * The wagmi config AppKit adapts.
 *
 * Null when there is no project id, so the provider skips `createAppKit`
 * instead of throwing at import and taking the whole route down. The fee step
 * degrades to an honest "not configured" notice in that case.
 */
export const wagmiAdapter: WagmiAdapter | null = walletProjectId
  ? new WagmiAdapter({
      networks: WALLET_NETWORKS,
      projectId: walletProjectId,
      ssr: true,
    })
  : null;

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'http://localhost:3000';

export const appkitMetadata = {
  name: 'Kade',
  description: 'Kade — pay the pre-approval fee on Ethereum Sepolia.',
  url: siteUrl,
  icons: [`${siteUrl}/onchain-island-logo.png`],
};
