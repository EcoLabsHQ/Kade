/**
 * Chain id → server-only JSON-RPC environment variable.
 *
 * The resident-Safe rail and the pre-flight USDC balance read both need the RPC
 * endpoint of the **deposit chain**, and both must resolve the same variable
 * name so they cannot drift. The names are defined once here and read by
 * `apps/web/src/lib/safe/execute-safe-4337-env.ts` and
 * `apps/web/src/lib/invest/safe-usdc-balance.ts`.
 *
 * Only the variable **names** live here; no endpoint or key is stored, so
 * importing this module can never make an unconfigured chain look reachable.
 *
 * Supported chains are the four the Invest rail and the Safe path actually use:
 * Ethereum Sepolia, Ethereum mainnet, Base and Arbitrum One. A testnet Base or
 * Arbitrum (Base Sepolia / Arbitrum Sepolia) is deliberately absent: those
 * remain deferred, so a caller naming one is refused loudly rather than sent to
 * an endpoint nobody configured.
 */

import { CHAIN_IDS } from './chains.js';

export const RPC_ENV_VAR_BY_CHAIN: Readonly<Record<number, string>> = {
  [CHAIN_IDS.sepolia]: 'SEPOLIA_RPC_URL',
  [CHAIN_IDS.ethereum]: 'ETHEREUM_RPC_URL',
  [CHAIN_IDS.base]: 'BASE_RPC_URL',
  [CHAIN_IDS.arbitrum]: 'ARBITRUM_RPC_URL',
};

/**
 * The environment variable holding the JSON-RPC endpoint for `chainId`, or
 * `undefined` when the chain has no supported RPC variable.
 */
export function rpcEnvVarForChain(chainId: number): string | undefined {
  return RPC_ENV_VAR_BY_CHAIN[chainId];
}
