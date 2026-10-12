import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { arbitrum, base, mainnet, sepolia } from '@reown/appkit/networks';
import type { AppKitNetwork } from '@reown/appkit/networks';

/**
 * Reown AppKit configuration for the pre-approval fee payment (contract 8.9)
 * and for moving a holding to the vault.
 *
 * The connected wallet does two jobs: it pays the fee (USDC to the Kade
 * treasury) and it signs the "Move to vault" transfer of a holding the resident
 * actually owns. It is not a login and confers no authority over the resident
 * Safe.
 *
 * Everything here is client-side. The treasury address and the amount stay on
 * the server and are passed to the payment screen as props.
 */

/**
 * Every chain the wallet may be asked to reach.
 *
 * The fee controls (contract 8.9) settle on the **active settlement chain**
 * (`KADE_CHAIN_ENV`): Ethereum Sepolia under `testnet`, Ethereum under
 * `mainnet`. The first entry is the wallet's default, so **mainnet leads** and
 * the controls switch explicitly to whichever chain the server resolved.
 *
 * Holdings reads balances on Ethereum mainnet, Base and Arbitrum One
 * (`EVM_READ_CHAINS` in `@/lib/wealth/evm`) and moves each holding on the chain
 * it was read from. A chain the app reads but the wallet cannot reach would make
 * a displayed holding unmovable, so **the two lists are kept aligned**: every
 * chain added to the balance reads must be added here in the same change, and
 * vice versa.
 */
export const WALLET_NETWORKS: [AppKitNetwork, ...AppKitNetwork[]] = [
  mainnet,
  sepolia,
  base,
  arbitrum,
];

/**
 * The AppKit network for a settlement chain id, or undefined when the wallet
 * cannot reach it. The fee controls resolve their target through this table
 * rather than hard-coding a network, so a chain the server selected but AppKit
 * does not know degrades to "not configured" instead of sending to the wrong
 * chain.
 */
export function appkitNetworkForChainId(
  chainId: number,
): AppKitNetwork | undefined {
  switch (chainId) {
    case 1:
      return mainnet;
    case 11155111:
      return sepolia;
    case 8453:
      return base;
    case 42161:
      return arbitrum;
    default:
      return undefined;
  }
}

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
  description: 'Kade — pay the pre-approval fee on the settlement chain.',
  url: siteUrl,
  icons: [`${siteUrl}/onchain-island-logo.png`],
};
