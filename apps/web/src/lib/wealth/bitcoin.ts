import { readBitcoinApiBase } from '@/lib/env';
import type { BitcoinBalanceRead } from './types';

/**
 * Read-only Bitcoin balances through a mempool.space / Esplora-compatible API.
 *
 * Server-side only: the browser never calls the provider. There is no API key,
 * but the seam is kept so the endpoint can be pointed at a self-hosted instance
 * (`KADE_BITCOIN_API_BASE`) without touching callers. `readBitcoinBalance` is
 * pure and injectable — the caller can supply a `baseUrl` and a `fetchImpl`, so
 * tests never touch the network.
 */

/** Raised for an invalid address, a non-2xx provider response or a bad body. */
export class BitcoinReadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BitcoinReadError';
  }
}

export interface BitcoinReadOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * [arbitrary] The address format is not fixed by any governing document, so a
 * conservative pattern is used: it accepts mainnet/testnet bech32 and bech32m
 * (`bc1`/`tb1`) and base58 P2PKH/P2SH (`1`/`3`/`m`/`n`/`2`). It deliberately
 * rejects anything else, including EVM `0x…` addresses, rather than guessing.
 */
const BASE58_ADDRESS = /^[123mn][1-9A-HJ-NP-Za-km-z]{25,34}$/;
const BECH32_ADDRESS = /^(bc1|tb1)[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{11,71}$/;

/**
 * Canonical form for storage and comparison.
 *
 * Trims, and lower-cases bech32 (`bc1`/`tb1`) because BIP173 allows either case
 * for it. Base58 is **not** lower-cased: it is case-sensitive, so changing it
 * would corrupt the address. Without this, the same bech32 address pasted in the
 * other accepted case would defeat the `(profile_id, address, chain)` unique
 * index and consume two of the five slots.
 */
export function normalizeBitcoinAddress(value: string): string {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('bc1') || lower.startsWith('tb1')) return lower;
  return trimmed;
}

/** True when `value` looks like a Bitcoin address. Conservative by design. */
export function isBitcoinAddress(value: string): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // BIP173: an address is either all-lowercase or all-uppercase, never mixed.
  const lower = trimmed.toLowerCase();
  const uniformCase = trimmed === lower || trimmed === trimmed.toUpperCase();
  if (uniformCase && BECH32_ADDRESS.test(lower)) return true;
  return BASE58_ADDRESS.test(trimmed);
}

/** Format an integer satoshi amount as a fixed 8-decimal BTC string. */
export function formatBitcoin(satoshis: number): string {
  const sign = satoshis < 0 ? '-' : '';
  const absolute = Math.abs(satoshis);
  const whole = Math.floor(absolute / 100_000_000);
  const fraction = absolute % 100_000_000;
  return `${sign}${whole}.${String(fraction).padStart(8, '0')}`;
}

function resolveBase(baseUrl: string | undefined): string {
  return (baseUrl ?? readBitcoinApiBase()).replace(/\/+$/, '');
}

/**
 * USD value per BTC, or null when the price read fails for any reason.
 *
 * A missing price must never fail the balance read: the screen shows the BTC
 * amount and leaves the USD figure blank.
 */
async function readUsdPerBtc(
  base: string,
  fetchImpl: typeof fetch,
): Promise<number | null> {
  try {
    const response = await fetchImpl(`${base}/api/v1/prices`);
    if (!response.ok) return null;
    const body = (await response.json()) as { USD?: unknown } | null;
    const price = body?.USD;
    if (typeof price !== 'number' || !Number.isFinite(price)) return null;
    return price;
  } catch {
    return null;
  }
}

/**
 * Read the confirmed balance of a single address.
 *
 * @throws {BitcoinReadError} on an invalid address, a non-2xx response or a
 * malformed body. A failing price read is not an error: `usd` is then null.
 */
export async function readBitcoinBalance(
  address: string,
  options: BitcoinReadOptions = {},
): Promise<BitcoinBalanceRead> {
  const normalized = normalizeBitcoinAddress(address);
  if (!isBitcoinAddress(normalized)) {
    throw new BitcoinReadError(
      `"${address}" is not a recognised Bitcoin address.`,
    );
  }

  const base = resolveBase(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  const response = await fetchImpl(
    `${base}/api/address/${encodeURIComponent(normalized)}`,
  );
  if (!response.ok) {
    throw new BitcoinReadError(
      `The Bitcoin provider returned HTTP ${response.status}.`,
    );
  }

  let body: {
    chain_stats?: { funded_txo_sum?: unknown; spent_txo_sum?: unknown };
  } | null;
  try {
    body = (await response.json()) as typeof body;
  } catch (cause) {
    throw new BitcoinReadError(
      'The Bitcoin provider returned a malformed response.',
      { cause },
    );
  }

  const funded = body?.chain_stats?.funded_txo_sum;
  const spent = body?.chain_stats?.spent_txo_sum;
  if (
    typeof funded !== 'number' ||
    typeof spent !== 'number' ||
    !Number.isFinite(funded) ||
    !Number.isFinite(spent)
  ) {
    throw new BitcoinReadError(
      'The Bitcoin provider returned a malformed balance.',
    );
  }

  const satoshis = funded - spent;
  const btc = formatBitcoin(satoshis);
  const price = await readUsdPerBtc(base, fetchImpl);
  const usd = price === null ? null : Number(btc) * price;

  return { address: normalized, satoshis, btc, usd };
}
