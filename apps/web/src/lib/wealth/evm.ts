import { chainByChainId } from '@kade/shared';
import { getAddress } from 'viem';
import { readEvmExplorerApiBase } from '@/lib/env';
import type { EvmChainBalance } from './types';

/**
 * Read-only balances (native coin and USDC) for a pasted EVM address.
 *
 * Server-side only: the browser never calls the provider. Two Blockscout
 * endpoints are used per chain, both public and keyless:
 *
 *   - `GET /api/v2/addresses/{address}` returns `coin_balance` (a decimal string
 *     of wei) and `exchange_rate`, the native coin's USD price. One call gives
 *     both the native amount and its USD value.
 *   - `GET /api?module=account&action=tokenbalance&contractaddress={usdc}
 *          &address={address}&tag=latest` returns the raw USDC balance for one
 *     known contract, so the ERC-20 read is deterministic instead of paging
 *     through every token the address holds.
 *
 * There is no API key, so the read works against the public instances. The chain
 * list and `fetchImpl` are injectable, so tests never touch the network.
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
  /** USDC contract on this chain, from `@kade/shared` (Circle's deployments). */
  readonly usdcAddress: string;
}

/**
 * [external] USDC uses 6 decimals on every chain Circle deploys it to; the
 * contract is the authority, not this constant.
 */
export const USDC_DECIMALS = 6;

/** Resolve the configured USDC contract for a chain from the shared registry. */
function mainnetUsdc(chainId: number): string {
  const chain = chainByChainId(chainId);
  const address = chain?.usdcAddress.value;
  if (!address) {
    throw new Error(`No USDC address is configured for chain ${chainId}.`);
  }
  return address;
}

/**
 * [arbitrary] The product chains' **mainnets**, because wealth tracks real
 * assets: a resident wants the balance that actually exists, not a testnet
 * figure. This is a read-only call that moves nothing, and the chain list is
 * plain data, so it can be extended without touching the read logic. The USDC
 * addresses are not restated here: they come from `@kade/shared`.
 */
export const EVM_READ_CHAINS: readonly EvmReadChain[] = [
  {
    chainId: 1,
    name: 'Ethereum',
    symbol: 'ETH',
    baseUrl: 'https://eth.blockscout.com',
    usdcAddress: mainnetUsdc(1),
  },
  {
    chainId: 8453,
    name: 'Base',
    symbol: 'ETH',
    baseUrl: 'https://base.blockscout.com',
    usdcAddress: mainnetUsdc(8453),
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

/** Format a raw integer amount as a fixed `decimals`-place decimal string. */
export function formatUnits(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const absolute = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = absolute % base;
  return `${negative ? '-' : ''}${whole}.${fraction
    .toString()
    .padStart(decimals, '0')}`;
}

/** Format a wei amount as a fixed 18-decimal native string. */
export function formatNative(wei: bigint): string {
  return formatUnits(wei, 18);
}

function toUsd(amount: string, rate: unknown): number | null {
  if (rate === null || rate === undefined) return null;
  const value = Number(rate);
  if (!Number.isFinite(value)) return null;
  return Number(amount) * value;
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
 * Read the USDC balance for the chain's known contract, or null when the read
 * fails. A missing token balance is not fabricated as zero.
 */
async function readUsdcBalance(
  chain: EvmReadChain,
  address: string,
  fetchImpl: typeof fetch,
): Promise<{ readonly symbol: string; readonly amount: string; readonly usd: number } | null> {
  const base = chain.baseUrl.replace(/\/+$/, '');
  try {
    const url =
      `${base}/api?module=account&action=tokenbalance` +
      `&contractaddress=${chain.usdcAddress}&address=${address}&tag=latest`;
    const response = await fetchImpl(url);
    if (!response.ok) return null;

    const body = (await response.json()) as { result?: unknown } | null;
    const raw = body?.result;
    if (typeof raw !== 'string' && typeof raw !== 'number') return null;

    const amount = formatUnits(BigInt(raw), USDC_DECIMALS);
    // USDC is a dollar: its USD value is its amount. The contract is not the
    // price source, but the peg is what the product relies on and the DOCX
    // treats USDC as 1:1 with USD.
    return { symbol: 'USDC', amount, usd: Number(amount) };
  } catch {
    return null;
  }
}

/**
 * Read one chain, or null when the native read fails.
 *
 * A chain failure (non-2xx, malformed JSON, a missing or unparseable balance) is
 * **skipped** rather than fabricated as a zero balance: the caller sees the
 * chain missing from the result and can say so honestly. A failed USDC read
 * keeps the chain and reports `usdc: null`.
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

    const nativeAmount = formatNative(wei);
    const nativeUsd = toUsd(nativeAmount, body?.exchange_rate);
    const usdc = await readUsdcBalance(chain, address, fetchImpl);

    const parts = [nativeUsd, usdc?.usd].filter(
      (value): value is number => value !== null && value !== undefined,
    );

    return {
      chainId: chain.chainId,
      name: chain.name,
      nativeSymbol: chain.symbol,
      nativeAmount,
      nativeUsd,
      usdc,
      usd: parts.length === 0 ? null : parts.reduce((sum, value) => sum + value, 0),
    };
  } catch {
    return null;
  }
}

/**
 * Read the native-coin and USDC balances of `address` on each target chain.
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
