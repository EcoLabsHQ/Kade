/**
 * The Safe{Wallet} web-app link for the resident's Safe.
 *
 * The chain is named by Safe{Wallet}'s own short name (`eth`, `sep`, `base`, …)
 * prefixed on the address in the `safe` query parameter:
 *
 *   https://app.safe.global/home?safe=<shortName>:<address>
 *
 * Sources:
 *   - Safe{Wallet} itself reads the address from the `safe` query parameter
 *     (`apps/web/src/hooks/useSafeAddressFromUrl.ts` in
 *     `safe-global/safe-wallet-monorepo`, `parsePrefixedAddress`).
 *   - the short name per chain comes from the Safe Client Gateway chain config,
 *     `GET https://safe-client.safe.global/v1/chains/{chainId}` (field
 *     `shortName`), which is mirrored in `@kade/shared`'s chain registry.
 *
 * The older path form (`https://app.safe.global/eth:0x…/home`) is no longer
 * routed by Safe{Wallet}: the site serves its 404 page for it. The query form
 * above is the one that resolves.
 *
 * The chain is identified from the block explorer the shell already resolved for
 * the Safe's *recorded* chain, never from the app's active chain environment:
 * the engine records the Safe on Ethereum Sepolia even under a mainnet
 * `KADE_CHAIN_ENV`, and the two chains must not be confused.
 */

import { ALL_CHAINS, type ChainConfig } from '@kade/shared';

/** The Safe{Wallet} origin. Shared so the URL format lives in one place. */
export const SAFE_APP_ORIGIN = 'https://app.safe.global';

/**
 * The registry chain whose block explorer is `explorerUrl`, or null.
 *
 * The shell hands out the explorer base for the chain the Safe is recorded on,
 * and the registry's `explorerUrl` is unique per chain, so an exact match
 * recovers that chain without the shell having to expose a chain id.
 */
export function safeChainForExplorer(
  explorerUrl: string | null,
): ChainConfig | null {
  if (!explorerUrl) return null;
  return ALL_CHAINS.find((chain) => chain.explorerUrl === explorerUrl) ?? null;
}

/**
 * The Safe{Wallet} deep link for `address` on the chain identified by
 * `explorerUrl`, or null when it cannot be built honestly.
 *
 * Returns null when there is no address, no recorded chain, a chain Safe{Wallet}
 * does not list, or a chain with no short name — a broken link is worse than no
 * link. It does **not** depend on the Safe being deployed: a counterfactual Safe
 * has a real address, and Safe{Wallet} resolves it just the same.
 */
export function safeAppUrl(
  explorerUrl: string | null,
  address: string | null,
): string | null {
  if (!address) return null;
  const shortName = safeChainForExplorer(explorerUrl)?.safeAppShortName.value;
  if (!shortName) return null;
  return `${SAFE_APP_ORIGIN}/home?safe=${shortName}:${address}`;
}
