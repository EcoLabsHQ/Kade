import { chainsForEnv, type Address, type ChainEnv } from '@kade/shared';
import { readChainEnv, readRpcUrlFor, readTreasuryAddressFor } from '@/lib/env';

/**
 * The active settlement chain both fee rails pay on.
 *
 * `KADE_CHAIN_ENV=testnet` (the default) resolves Ethereum Sepolia; `mainnet`
 * resolves Ethereum. The treasury, RPC endpoint and token all come from the
 * same environment, so the two fees can never settle on different chains. This
 * is the single server resolver; the browser receives the resolved values as
 * props and never substitutes an address, amount or chain of its own.
 */
export interface FeeSettlementRail {
  readonly chainEnv: ChainEnv;
  readonly chainId: number;
  readonly chainName: string;
  /** USDC on the settlement chain. */
  readonly token: Address;
  readonly treasury: Address;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
}

/**
 * The active settlement rail, or null when the environment cannot support a
 * verifiable payment (no treasury, no RPC, or no USDC token).
 *
 * Returning null (rather than throwing or pointing at a placeholder) lets both
 * fee steps report `not-configured` instead of rendering a control that could
 * only fail.
 */
export function readFeeSettlementRail(): FeeSettlementRail | null {
  const chainEnv = readChainEnv();
  const chains = chainsForEnv(chainEnv);
  const settlement = chains.find((c) => c.key === 'ethereum') ?? chains[0];
  if (!settlement) return null;
  const treasury = readTreasuryAddressFor(chainEnv);
  const rpcUrl = readRpcUrlFor(chainEnv);
  const token = settlement.usdcAddress.value;
  if (!treasury || !rpcUrl || !token) return null;
  return {
    chainEnv,
    chainId: settlement.chainId,
    chainName: settlement.name,
    token: token as Address,
    treasury: treasury as Address,
    rpcUrl,
    explorerUrl: settlement.explorerUrl,
  };
}
