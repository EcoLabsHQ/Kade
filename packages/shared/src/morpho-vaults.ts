/**
 * The MetaMorpho vault rail — the pinned per-chain deployments.
 *
 * Source: the project owner directed that the vault rail cover Ethereum
 * mainnet, Base and Arbitrum One, so a resident can deposit into the vault on
 * whichever chain holds their funds. Each vault below was **verified on chain**
 * before being pinned here (a prior research task, T23):
 *
 *   - ERC-4626 + MetaMorpho surface present;
 *   - `asset()` equals the canonical Circle USDC for that chain (recorded
 *     alongside the vault so the deposit approves the exact token the vault
 *     pulls);
 *   - EIP-55 valid and bytecode present.
 *
 * The MetaMorpho **share** token has 18 decimals while the underlying USDC has
 * 6, so `convertToAssets(1e6) == 0` is correct and expected; the vault's
 * share→asset valuation is read through `convertToAssets`, never assumed 1:1.
 *
 * This table is the single source of truth for "which vault, on which chain,
 * for which USDC". It is deliberately keyed by chain id: a caller that names a
 * chain resolves **that** chain's vault, and a chain absent from this table has
 * no rail — a reader must fail closed rather than borrow another chain's vault.
 */

import { CHAIN_IDS, type ChainId } from './chains.js';
import { sourced, type Sourced } from './provenance.js';

/** One chain's pinned MetaMorpho vault and the USDC it takes (`asset()`). */
export interface MetaMorphoVaultDeployment {
  readonly chainId: ChainId;
  /** The MetaMorpho vault to deposit into on `chainId`. */
  readonly vault: Sourced<`0x${string}`>;
  /** The vault's underlying USDC — the token the Safe approves. */
  readonly usdc: Sourced<`0x${string}`>;
}

/**
 * The three verified MetaMorpho vaults, keyed by chain id.
 *
 * These are the values the owner's research task verified; do not substitute
 * another vault, another chain id or the bridged Arbitrum USDC
 * (`0xFF97…5CC8`). Arbitrum's USDC here is Circle's native deployment
 * (`0xaf88…5831`), which is what the Steakhouse High Yield vault takes.
 */
export const METAMORPHO_VAULT_DEPLOYMENTS: Readonly<
  Record<number, MetaMorphoVaultDeployment>
> = {
  [CHAIN_IDS.ethereum]: {
    chainId: CHAIN_IDS.ethereum,
    vault: sourced(
      '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB',
      'external',
      'Steakhouse USDC MetaMorpho vault on Ethereum mainnet; verified on chain (ERC-4626 + MetaMorpho surface, asset() = canonical USDC, EIP-55 valid, bytecode present)',
    ),
    usdc: sourced(
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      'external',
      "the vault's asset(); Circle native USDC on Ethereum mainnet",
    ),
  },
  [CHAIN_IDS.base]: {
    chainId: CHAIN_IDS.base,
    vault: sourced(
      '0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61',
      'external',
      'Gauntlet USDC Prime MetaMorpho vault on Base; verified on chain (ERC-4626 + MetaMorpho surface, asset() = canonical USDC, EIP-55 valid, bytecode present)',
    ),
    usdc: sourced(
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      'external',
      "the vault's asset(); Circle native USDC on Base",
    ),
  },
  [CHAIN_IDS.arbitrum]: {
    chainId: CHAIN_IDS.arbitrum,
    vault: sourced(
      '0x5c0C306Aaa9F877de636f4d5822cA9F2E81563BA',
      'external',
      'Steakhouse High Yield USDC MetaMorpho vault on Arbitrum One; verified on chain (ERC-4626 + MetaMorpho surface, asset() = canonical USDC, EIP-55 valid, bytecode present)',
    ),
    usdc: sourced(
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      'external',
      "the vault's asset(); Circle native USDC on Arbitrum One — NOT the bridged 0xFF97…5CC8",
    ),
  },
};

/** The chain ids that have a pinned MetaMorpho vault, in contract order. */
export const MORPHO_VAULT_CHAIN_IDS: readonly ChainId[] = [
  CHAIN_IDS.ethereum,
  CHAIN_IDS.base,
  CHAIN_IDS.arbitrum,
];

/**
 * The pinned vault deployment for one chain, or `undefined` when that chain has
 * no MetaMorpho rail. Pure lookup: it never falls back across chains.
 */
export function morphoVaultDeploymentForChain(
  chainId: number,
): MetaMorphoVaultDeployment | undefined {
  return METAMORPHO_VAULT_DEPLOYMENTS[chainId];
}
