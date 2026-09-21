import { getAddress } from 'viem';
import { readEvmExplorerApiBase } from '@/lib/env';
import type { EvmChainBalance } from './types';

/**
 * Read-only native-coin balances for a pasted EVM address.
 *
 * Server-side only: the browser never calls the provider. Balances come from the
 * Blockscout v2 REST API (`/api/v2/addresses/{address}`), which returns
 * `coin_balance` as a decimal string of wei and `exchange_rate` as the native
 * coin's USD price. There is no API key, so the read works against the public
 * instances; the chain list and `fetchImpl` are injectable so tests never touch
 * the network.
 */

/** Raised for an invalid address, a non-2xx provider response or a bad body. */
export class EvmReadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EvmReadError';
  }
}

/** One chain the balance read targets. Data, so the list can be extended. */
export interface EvmReadChain {
  readonly chainId: number;
  readonly name: string;
  readonly symbol: string;
  readonly baseUrl: string;
}

/**
 * [arbitrary] The product chains' **mainnets**, because wealth tracks real
 * assets: a resident wants the balance that actually exists, not a testnet
 * figure. This is a read-only call that moves nothing, and the chain list is
 * plain data, so it can be extended without touching the read logic.
 */
export const EVM_READ_CHAINS: readonly EvmReadChain[] = [
  {
    chainId: 1,
    name: 'Ethereum',
    symbol: 'ETH',
    baseUrl: 'https://eth.blockscout.com',
  },
  {
    chainId: 8453,
    name: 'Base',
    symbol: 'ETH',
    baseUrl: 'https://base.blockscout.com',
  },
];

/** `0x` followed by exactly 40 hex digits, the EVM address shape. */
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** True when `value` is `0x` + 40 hex digits. */
export function isEvmAddress(value: string): boolean {
  if (typeof value !== 'string') return false;
  return EVM_ADDRESS.test(value.trim());
}

/**
 * Canonical form for storage and comparison: trimmed and EIP-55 checksummed, so
 * the same address pasted in a different case occupies one slot.
 *
 * @throws {EvmReadError} when the value is not a valid EVM address, including
 * one whose mixed-case checksum does not verify.
 */
export function normalizeEvmAddress(value: string): string {
  const trimmed = value.trim();
  if (!isEvmAddress(trimmed)) {
    throw new EvmReadError(`"${value}" is not a recognised EVM address.`);
  }
  try {
    return getAddress(trimmed);
  } catch (cause) {
    throw new EvmReadError(`"${value}" has an invalid EIP-55 checksum.`, {
      cause,
    });
  }
}

/** Format a wei amount as a fixed 18-decimal native string. */
export function formatNative(wei: bigint): string {
  const negative = wei < 0n;
  const absolute = negative ? -wei : wei;
  const base = 10n ** 18n;
  const whole = absolute / base;
  const fraction = absolute % base;
  return `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(18, '0')}`;
}

export interface EvmReadOptions {
  readonly chains?: readonly EvmReadChain[];
  readonly fetchImpl?: typeof fetch;
}

function resolveChains(
  chains: readonly EvmReadChain[] | undefined,
): readonly EvmReadChain[] {
  if (chains) return chains;
  const override = readEvmExplorerApiBase();
  if (!override) return EVM_READ_CHAINS;
  const base = override.replace(/\/+$/, '');
  return EVM_READ_CHAINS.map((chain) => ({ ...chain, baseUrl: base }));
}

/**
 * Read one chain, or null when it fails.
 *
 * A chain failure (non-2xx, malformed JSON, a missing or unparseable balance) is
 * **skipped** rather than fabricated as a zero balance: the caller sees the
 * chain missing from the result and can say so honestly.
 */
async function readChainBalance(
  chain: EvmReadChain,
  address: string,
  fetchImpl: typeof fetch,
): Promise<EvmChainBalance | null> {
  const base = chain.baseUrl.replace(/\/+$/, '');
  try {
    const response = await fetchImpl(`${base}/api/v2/addresses/${address}`);
    if (!response.ok) return null;

    const body = (await response.json()) as {
      coin_balance?: unknown;
      exchange_rate?: unknown;
    } | null;

    const raw = body?.coin_balance;
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;

    let wei: bigint;
    try {
      wei = BigInt(raw);
    } catch {
      return null;
    }

    const amount = formatNative(wei);
    const rate = body?.exchange_rate;
    const rateValue =
      rate === null || rate === undefined ? null : Number(rate);
    const usd =
      rateValue !== null && Number.isFinite(rateValue)
        ? Number(amount) * rateValue
        : null;

    return {
      chainId: chain.chainId,
      name: chain.name,
      symbol: chain.symbol,
      amount,
      usd,
    };
  } catch {
    return null;
  }
}

/**
 * Read the native-coin balance of `address` on each target chain.
 *
 * @throws {EvmReadError} when the address is invalid, before any fetch. A
 * per-chain provider failure does not throw: that chain is skipped.
 */
export async function readEvmBalances(
  address: string,
  options: EvmReadOptions = {},
): Promise<EvmChainBalance[]> {
  const normalized = normalizeEvmAddress(address);
  const fetchImpl = options.fetchImpl ?? fetch;
  const chains = resolveChains(options.chains);

  const balances: EvmChainBalance[] = [];
  for (const chain of chains) {
    const balance = await readChainBalance(chain, normalized, fetchImpl);
    if (balance !== null) balances.push(balance);
  }
  return balances;
}
