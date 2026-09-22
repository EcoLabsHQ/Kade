import type { Address, ChainId } from '@kade/shared';
import { CHAIN_ENV_CONFIG } from '@kade/shared';
import { readEthereumRpcUrl, readMainnetTreasuryAddress } from '@/lib/env';

/**
 * Server-side Ethereum-mainnet configuration (EXE-010, week-2 contract
 * section 3).
 *
 * This is the single place the mainnet treasury, RPC endpoint, USDC contract
 * and chain id are assembled for server use. None of them is `NEXT_PUBLIC_`, so
 * the browser never receives the treasury address from this module: a caller
 * resolves the config on the server and passes down only the values a screen
 * needs.
 *
 * The contract's freeze checklist records that mainnet funding, RPC and
 * treasury are **not supplied**. The reads are therefore guarded: a missing or
 * malformed treasury or RPC makes the whole config `null`, which disables the
 * mainnet path instead of fabricating an address or an endpoint. The USDC
 * contract and chain id come from the frozen registry in `@kade/shared`, never
 * from a literal here.
 */

/** The frozen mainnet environment entry (chain id 1, Ethereum USDC). */
const MAINNET = CHAIN_ENV_CONFIG.mainnet;

export interface MainnetConfig {
  readonly chainId: ChainId;
  /** Server-resolved recipient of mainnet USDC fees. Never sent to the browser. */
  readonly treasury: Address;
  /** USDC contract on mainnet, from the frozen chain registry. */
  readonly token: Address;
  /** Server-only JSON-RPC endpoint. */
  readonly rpcUrl: string;
}

/**
 * The mainnet configuration, or null when the environment cannot support it.
 *
 * Returns null rather than throwing so a caller can render "not configured"
 * instead of an action that could only fail. A partially configured
 * environment (for example a treasury without an RPC) is also null: the mainnet
 * path is only live when the whole rail is present.
 */
export function readMainnetConfig(): MainnetConfig | null {
  const treasury = readMainnetTreasuryAddress();
  const rpcUrl = readEthereumRpcUrl();
  const token = MAINNET.chain.usdcAddress.value;
  if (!treasury || !rpcUrl || !token) return null;
  return {
    chainId: MAINNET.chain.chainId,
    treasury: treasury as Address,
    token: token as Address,
    rpcUrl,
  };
}

/** Whether the mainnet rail is fully configured. */
export function isMainnetConfigured(): boolean {
  return readMainnetConfig() !== null;
}
