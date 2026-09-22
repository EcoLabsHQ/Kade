/**
 * Chain-environment configuration.
 *
 * Source: docs/week-2-frozen-delivery-contract.md section 2.2 item 1 (Ethereum
 * mainnet is active in iteration 2), section 3 (EXE-010) and section 5 (the
 * mainnet payer, RPC and treasury are project-supplied dependencies).
 *
 * The registry in `./chains.ts` lists every chain; this module says which chain
 * settles each environment's native rail and which environment variables carry
 * the server-only RPC endpoint and treasury address for it. The variable names
 * are defined once here so `apps/web/src/lib/env.ts` and its tests cannot drift
 * from the environment contract.
 *
 * **No** mainnet RPC, payer or treasury value is defined here. The contract
 * freeze checklist records that mainnet funding is not supplied, so a missing
 * value at runtime must disable the mainnet path rather than fabricate one.
 */

import { CHAIN_IDS, chainByChainId } from './chains.js';
import type { ChainConfig, ChainEnv, ChainId } from './chains.js';

/** Chain environments. `testnet` is iteration 1, `mainnet` is iteration 2. */
export const CHAIN_ENVIRONMENTS: readonly ChainEnv[] = ['testnet', 'mainnet'];

/**
 * [documented] iteration 1 is all-testnet (week-1 contract section 2 item 7),
 * so an unset `KADE_CHAIN_ENV` must keep resolving to testnet. Activating
 * mainnet is an explicit configuration change, never an implicit default.
 */
export const DEFAULT_CHAIN_ENV: ChainEnv = 'testnet';

/**
 * The chain whose native rail settles each environment.
 *
 * [documented] testnet settles on Ethereum Sepolia and mainnet on Ethereum
 * (week-1 contract section 8.9; week-2 contract section 2.2 item 1). The chain
 * set is frozen by the contract, so this table does not introduce a new chain.
 */
const SETTLEMENT_CHAIN_ID: Record<ChainEnv, ChainId> = {
  testnet: CHAIN_IDS.sepolia,
  mainnet: CHAIN_IDS.ethereum,
};

function requireChain(chainId: ChainId): ChainConfig {
  const chain = chainByChainId(chainId);
  if (chain === undefined) {
    // The registry and this table are frozen together, so a missing entry is a
    // programming error, not a runtime configuration state.
    throw new Error(`Chain ${chainId} is not present in the chain registry.`);
  }
  return chain;
}

export interface ChainEnvironmentConfig {
  readonly env: ChainEnv;
  /** The product chain whose USDC / fee rail this environment settles on. */
  readonly chain: ChainConfig;
  /** True for the Ethereum-mainnet environment. */
  readonly isMainnet: boolean;
  /** Server-only variable holding the JSON-RPC endpoint for `chain`. */
  readonly rpcUrlEnvVar: string;
  /** Server-only variable holding the treasury address for `chain`. */
  readonly treasuryEnvVar: string;
}

/**
 * The environment contract: which chain settles each environment and the
 * server-only variable names that supply its RPC endpoint and treasury.
 *
 * These are the *names* only. No address or URL is stored here, so importing
 * this module can never turn an unconfigured environment into a live one.
 */
export const CHAIN_ENV_CONFIG: Record<ChainEnv, ChainEnvironmentConfig> = {
  testnet: {
    env: 'testnet',
    chain: requireChain(SETTLEMENT_CHAIN_ID.testnet),
    isMainnet: false,
    rpcUrlEnvVar: 'SEPOLIA_RPC_URL',
    treasuryEnvVar: 'TREASURY_ADDRESS',
  },
  mainnet: {
    env: 'mainnet',
    chain: requireChain(SETTLEMENT_CHAIN_ID.mainnet),
    isMainnet: true,
    rpcUrlEnvVar: 'ETHEREUM_RPC_URL',
    treasuryEnvVar: 'MAINNET_TREASURY_ADDRESS',
  },
};

/**
 * The configuration for one chain environment. Pure: it reads the frozen
 * registry, never the process environment.
 */
export function chainEnvironmentConfig(env: ChainEnv): ChainEnvironmentConfig {
  return CHAIN_ENV_CONFIG[env];
}
