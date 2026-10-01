import {
  MORPHO_VAULT_CHAIN_IDS,
  chainByChainId,
  rpcEnvVarForChain,
} from '@kade/shared';
import { createPublicClient, formatUnits, http, type Address } from 'viem';
import {
  VIEM_CHAIN_BY_ID,
  readSafeUsdcBalanceFromRpc,
} from '@/lib/invest/safe-usdc-balance';
import { EVM_READ_CHAINS, usdcAddressForChain } from '@/lib/wealth/evm';
import {
  NATIVE_DECIMALS,
  USDC_DECIMALS,
  type OperatorWithdrawBalance,
  type OperatorWithdrawToken,
} from './types';

/**
 * The operator-withdrawal balance reads (server-side only).
 *
 * The route reads the resident Safe's USDC and native balances on each
 * supported vault chain (Ethereum mainnet, Base, Arbitrum One) and passes them
 * to the client as display values, so the browser neither reads nor hard-codes
 * an amount. The same readers back the server action's pre-flight validation,
 * so what the screen shows and what the action accepts cannot disagree.
 *
 * No new provider is introduced: the USDC read is the app's existing
 * `readSafeUsdcBalanceFromRpc`, and the native read resolves the chain's own
 * RPC variable exactly as that reader does. A chain whose endpoint is unset or
 * unreadable is a `failed` read carrying its real reason — never a fabricated
 * zero, and never another chain's endpoint.
 */

/** One balance read outcome: the raw amount, or the real reason it failed. */
export type SafeBalanceRead =
  | { readonly status: 'read'; readonly balance: bigint }
  | { readonly status: 'failed'; readonly reason: string };

/** A readable message from an unknown thrown value. */
function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The human chain name, or a stable fallback when the registry has none. */
function chainNameOf(chainId: number): string {
  return chainByChainId(chainId)?.name ?? `chain ${chainId}`;
}

/** The native symbol the app uses for a chain, from its existing read table. */
function nativeSymbolOf(chainId: number): string {
  return EVM_READ_CHAINS.find((chain) => chain.chainId === chainId)?.symbol ?? 'ETH';
}

/**
 * Read the Safe's native balance from the chain's **own** RPC.
 *
 * Mirrors `readSafeUsdcBalanceFromRpc`: the endpoint comes from the chain's
 * server-only variable, a chain with no variable (or an unset one) is refused
 * with a specific reason, and the Safe is read by address regardless of whether
 * it is deployed. It never falls back to another chain's endpoint or to a
 * third-party provider, and a failed read is never turned into a zero.
 */
export async function readSafeNativeBalanceFromRpc(input: {
  readonly safeAddress: Address;
  readonly chainId: number;
}): Promise<SafeBalanceRead> {
  const variable = rpcEnvVarForChain(input.chainId);
  if (!variable) {
    return {
      status: 'failed',
      reason:
        `chain ${input.chainId} has no RPC variable, so the native balance ` +
        'cannot be read',
    };
  }

  const rpcUrl = process.env[variable]?.trim();
  if (!rpcUrl) {
    return {
      status: 'failed',
      reason:
        `the ${chainNameOf(input.chainId)} RPC endpoint (${variable}) is not ` +
        'set, so the native balance cannot be read',
    };
  }

  const chain = VIEM_CHAIN_BY_ID[input.chainId];
  if (!chain) {
    return {
      status: 'failed',
      reason:
        `chain ${input.chainId} is not a supported withdrawal chain, so the ` +
        'native balance cannot be read',
    };
  }

  try {
    const client = createPublicClient({ chain, transport: http(rpcUrl) });
    const balance = await client.getBalance({ address: input.safeAddress });
    return { status: 'read', balance };
  } catch (cause) {
    return {
      status: 'failed',
      reason: `the native balance read failed: ${reasonOf(cause)}`,
    };
  }
}

/**
 * Read the Safe's balance for the named token on the named chain.
 *
 * USDC reuses the app's existing `readSafeUsdcBalanceFromRpc` (the token the
 * withdrawal transfers is the one this app already reads); native uses the
 * sibling read above. Both are strict: a failed read refuses rather than
 * passing.
 */
export async function readSafeTokenBalance(input: {
  readonly safeAddress: Address;
  readonly chainId: number;
  readonly token: OperatorWithdrawToken;
}): Promise<SafeBalanceRead> {
  if (input.token === 'native') {
    return readSafeNativeBalanceFromRpc({
      safeAddress: input.safeAddress,
      chainId: input.chainId,
    });
  }

  const usdc = usdcAddressForChain(input.chainId);
  if (!usdc) {
    return {
      status: 'failed',
      reason:
        `no USDC contract is configured for chain ${input.chainId}, so its ` +
        'balance cannot be read',
    };
  }
  return readSafeUsdcBalanceFromRpc({
    safeAddress: input.safeAddress,
    usdc: usdc as Address,
    chainId: input.chainId,
  });
}

/**
 * Read the Safe's USDC and native balances on every supported vault chain, as
 * serialisable display rows. A null address (no Safe recorded) yields no rows.
 */
export async function loadOperatorWithdrawBalances(
  safeAddress: string | null,
): Promise<OperatorWithdrawBalance[]> {
  if (!safeAddress) return [];
  const address = safeAddress as Address;

  return Promise.all(
    MORPHO_VAULT_CHAIN_IDS.map(async (chainId) => {
      const [native, usdc] = await Promise.all([
        readSafeNativeBalanceFromRpc({ safeAddress: address, chainId }),
        readSafeTokenBalance({ safeAddress: address, chainId, token: 'usdc' }),
      ]);
      return {
        chainId,
        chainName: chainNameOf(chainId),
        nativeSymbol: nativeSymbolOf(chainId),
        nativeAmount:
          native.status === 'read'
            ? formatUnits(native.balance, NATIVE_DECIMALS)
            : null,
        nativeReason: native.status === 'failed' ? native.reason : null,
        usdcAmount:
          usdc.status === 'read'
            ? formatUnits(usdc.balance, USDC_DECIMALS)
            : null,
        usdcReason: usdc.status === 'failed' ? usdc.reason : null,
      } satisfies OperatorWithdrawBalance;
    }),
  );
}
