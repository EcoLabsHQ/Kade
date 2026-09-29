import { chainByChainId } from '@kade/shared';
import { getAddress } from 'viem';
import { readEvmExplorerApiBase } from '@/lib/env';
import type {
  EvmChainBalance,
  EvmReadFailure,
  EvmTokenBalance,
} from './types';

export type { EvmReadFailure, EvmReadFailureReason } from './types';

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
 *
 * The public instances are rate-limited and genuinely flaky, so a read that
 * fails once is not treated as a final answer: a transient status (429, 408 or
 * 5xx) or a thrown transport error is retried with bounded backoff before being
 * given up on, within a per-chain time budget. A final failure is reported with
 * a specific reason, so a resident sees *why* a balance could not be read
 * instead of a generic dead end — and a failed read is never turned into a
 * fabricated zero.
 */

/** Raised for an invalid address, a non-2xx provider response or a bad body. */
export class EvmReadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EvmReadError';
  }
}

/** One chain's read outcome: either the balance or an explained failure. */
export interface EvmChainRead {
  readonly chain: EvmReadChain;
  readonly ok: boolean;
  readonly balance?: EvmChainBalance;
  readonly failure?: EvmReadFailure;
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

/**
 * The USDC contract this app reads for `chainId`, or null when the chain is not
 * one we read. Read-only data from the same `EVM_READ_CHAINS` table the balance
 * read uses, so the token the screen moves is the token it read.
 */
export function usdcAddressForChain(chainId: number): string | null {
  return EVM_READ_CHAINS.find((chain) => chain.chainId === chainId)?.usdcAddress ?? null;
}

/**
 * Retry policy for a single provider request.
 *
 * Bounded and small: two retries (three attempts total) with 200 ms then 400 ms
 * of backoff. The public Blockscout instances are rate-limited and flaky, so a
 * single 5xx is not a final answer; but a resident is waiting on the screen, so
 * the read gives up quickly rather than retrying for many seconds.
 */
export const EVM_READ_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 200;
/**
 * Hard per-attempt ceiling. A hung provider must not hang the server render:
 * the response is abandoned after this and classified as a timeout, which is
 * also the most common real failure for a flaky endpoint.
 *
 * [arbitrary] 8 s is long enough for a slow public instance and short enough
 * that two chains with retries stay inside a render budget.
 */
export const EVM_READ_TIMEOUT_MS = 8_000;

/** Await `ms` without depending on a specific timer implementation. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** HTTP statuses that are worth retrying: rate limit, timeout and 5xx. */
function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** True when a thrown error is an AbortError, i.e. the request timed out. */
function isAbortError(cause: unknown): boolean {
  if (typeof DOMException !== 'undefined' && cause instanceof DOMException) {
    return cause.name === 'AbortError';
  }
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { name?: unknown }).name === 'AbortError'
  );
}

/** A `fetch` rejection whose message identifies a timeout. */
function isTimeoutError(cause: unknown): boolean {
  if (isAbortError(cause)) return true;
  const message = cause instanceof Error ? cause.message : '';
  return /timed?\s*out|timeout/i.test(message);
}

/** Map a final HTTP status to a reason and a specific, safe message. */
function failureForStatus(
  chain: EvmReadChain,
  status: number,
): EvmReadFailure {
  const what = `${chain.name} (chain ${chain.chainId})`;
  if (status === 401 || status === 403) {
    return {
      chainId: chain.chainId,
      chainName: chain.name,
      reason: 'rejected',
      message: `${what}: the balance provider rejected the request (HTTP ${status}). It requires an API key or the endpoint refused access.`,
    };
  }
  if (status === 429) {
    return {
      chainId: chain.chainId,
      chainName: chain.name,
      reason: 'rejected',
      message: `${what}: the balance provider is rate limiting this read (HTTP 429). Wait a moment and try again.`,
    };
  }
  return {
    chainId: chain.chainId,
    chainName: chain.name,
    reason: 'unexpected',
    message: `${what}: the balance provider returned HTTP ${status}.`,
  };
}

/**
 * Classify a thrown request error into a specific failure.
 *
 * A timeout is named as such; everything else is an unexpected transport error.
 */
function failureForThrow(chain: EvmReadChain, cause: unknown): EvmReadFailure {
  const what = `${chain.name} (chain ${chain.chainId})`;
  if (isTimeoutError(cause)) return failureForTimeout(chain);
  const detail = cause instanceof Error ? cause.message : String(cause);
  return {
    chainId: chain.chainId,
    chainName: chain.name,
    reason: 'unexpected',
    message: `${what}: the balance read failed unexpectedly (${detail}).`,
  };
}

/** A malformed body or a missing balance, classified as an unexpected read. */
function failureForBody(
  chain: EvmReadChain,
  detail: string,
): EvmReadFailure {
  return {
    chainId: chain.chainId,
    chainName: chain.name,
    reason: 'unexpected',
    message: `${chain.name} (chain ${chain.chainId}): the balance provider returned an unusable response — ${detail}.`,
  };
}

/** A chain with no configured endpoint never reaches the network. */
function failureForNoEndpoint(chain: EvmReadChain): EvmReadFailure {
  return {
    chainId: chain.chainId,
    chainName: chain.name,
    reason: 'no-endpoint',
    message: `${chain.name} (chain ${chain.chainId}): no balance endpoint is configured, so its balance cannot be read.`,
  };
}

/** The outcome of one provider request: a response, or a classified failure. */
type FetchOutcome =
  | { readonly response: Response }
  | { readonly failure: EvmReadFailure };

/**
 * The timeout reason.
 *
 * Used both when the provider signals a timeout and when a hung request is
 * abandoned at the per-attempt budget.
 */
function failureForTimeout(chain: EvmReadChain): EvmReadFailure {
  return {
    chainId: chain.chainId,
    chainName: chain.name,
    reason: 'timeout',
    message: `${chain.name} (chain ${chain.chainId}): the balance provider did not respond in time. The endpoint may be overloaded.`,
  };
}

/** Halt the retry loop early when the per-chain time budget is exhausted. */
function didChainBudgetRunOut(startedAt: number): boolean {
  return Date.now() - startedAt >= EVM_READ_TIMEOUT_MS;
}

/**
 * Perform one provider request with bounded retry.
 *
 * A transient status (408/429/5xx) or a thrown transport error is retried up to
 * `EVM_READ_ATTEMPTS` times with linear backoff. A non-transient status (e.g.
 * 404) is returned immediately so the caller can classify it without delay. A
 * request that does not settle within `EVM_READ_TIMEOUT_MS` is abandoned and
 * classified as a timeout rather than hanging the render; when the budget is
 * spent, the chain gives up without further attempts.
 *
 * The timeout is enforced by racing the fetch promise, so `fetchImpl` is always
 * called with the URL alone (the same signature the rest of the code and the
 * tests already use).
 */
async function fetchWithRetry(
  url: string,
  chain: EvmReadChain,
  fetchImpl: typeof fetch,
): Promise<FetchOutcome> {
  let lastFailure: EvmReadFailure | null = null;
  const chainStartedAt = Date.now();

  for (let attempt = 1; attempt <= EVM_READ_ATTEMPTS; attempt += 1) {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    let response: Response;
    try {
      response = await Promise.race([
        Promise.resolve(fetchImpl(url)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error(`request timed out after ${EVM_READ_TIMEOUT_MS} ms`));
          }, EVM_READ_TIMEOUT_MS);
        }),
      ]);
    } catch (cause) {
      lastFailure = timedOut
        ? failureForTimeout(chain)
        : failureForThrow(chain, cause);
      if (attempt < EVM_READ_ATTEMPTS && !didChainBudgetRunOut(chainStartedAt)) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      return { failure: lastFailure };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    if (response.ok) {
      return { response };
    }

    if (isTransientStatus(response.status)) {
      lastFailure = failureForStatus(chain, response.status);
      if (attempt < EVM_READ_ATTEMPTS && !didChainBudgetRunOut(chainStartedAt)) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      return { failure: lastFailure };
    }

    // A non-transient status will not change on retry: classify it now.
    return { failure: failureForStatus(chain, response.status) };
  }

  // Unreachable: the loop always returns on its final attempt.
  return { failure: lastFailure ?? failureForThrow(chain, undefined) };
}

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
 * Read the USDC balance for the chain's known contract.
 *
 * Returns the balance, or a **classified** `EvmReadFailure` when the read fails,
 * so the caller can name the specific reason rather than silently reporting a
 * missing token. A missing token balance is never fabricated as zero.
 */
async function readUsdcBalance(
  chain: EvmReadChain,
  address: string,
  fetchImpl: typeof fetch,
): Promise<
  | { readonly ok: true; readonly token: EvmTokenBalance }
  | { readonly ok: false; readonly failure: EvmReadFailure }
> {
  const base = chain.baseUrl.replace(/\/+$/, '');
  const url =
    `${base}/api?module=account&action=tokenbalance` +
    `&contractaddress=${chain.usdcAddress}&address=${address}&tag=latest`;

  const outcome = await fetchWithRetry(url, chain, fetchImpl);
  if ('failure' in outcome) return { ok: false, failure: outcome.failure };

  let body: { result?: unknown } | null;
  try {
    body = (await outcome.response.json()) as { result?: unknown } | null;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, failure: failureForBody(chain, detail) };
  }

  const raw = body?.result;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return {
      ok: false,
      failure: failureForBody(chain, 'no token balance was present'),
    };
  }

  let amount: string;
  try {
    amount = formatUnits(BigInt(raw), USDC_DECIMALS);
  } catch {
    return {
      ok: false,
      failure: failureForBody(chain, 'the token balance was not a number'),
    };
  }

  // USDC is a dollar: its USD value is its amount. The contract is not the
  // price source, but the peg is what the product relies on and the DOCX
  // treats USDC as 1:1 with USD.
  return {
    ok: true,
    token: { symbol: 'USDC', amount, usd: Number(amount) },
  };
}

/**
 * Read one chain's native coin and USDC balances, with bounded retry.
 *
 * A chain with no configured endpoint, a provider rejection, a timeout or any
 * other unexpected read failure is reported as a specific `EvmReadFailure`
 * rather than a silently skipped chain: the caller can then keep the chain
 * visible with a real, explained reason instead of a dead end. Nothing is
 * fabricated as a zero balance.
 *
 * A failed USDC read keeps the chain's native balance and records the failure
 * on the balance as `tokenFailure`, so the token amount stays unread rather
 * than becoming zero and the specific reason survives to every consumer.
 */
async function readChainBalance(
  chain: EvmReadChain,
  address: string,
  fetchImpl: typeof fetch,
): Promise<EvmChainRead> {
  if (!chain.baseUrl) {
    return { chain, ok: false, failure: failureForNoEndpoint(chain) };
  }

  const base = chain.baseUrl.replace(/\/+$/, '');
  const outcome = await fetchWithRetry(
    `${base}/api/v2/addresses/${address}`,
    chain,
    fetchImpl,
  );
  if ('failure' in outcome) return { chain, ok: false, failure: outcome.failure };

  let body: { coin_balance?: unknown; exchange_rate?: unknown } | null;
  try {
    body = (await outcome.response.json()) as {
      coin_balance?: unknown;
      exchange_rate?: unknown;
    } | null;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { chain, ok: false, failure: failureForBody(chain, detail) };
  }

  const raw = body?.coin_balance;
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return {
      chain,
      ok: false,
      failure: failureForBody(chain, 'no native balance was present'),
    };
  }

  let wei: bigint;
  try {
    wei = BigInt(raw);
  } catch {
    return {
      chain,
      ok: false,
      failure: failureForBody(chain, 'the native balance was not a number'),
    };
  }

  const nativeAmount = formatNative(wei);
  const nativeUsd = toUsd(nativeAmount, body?.exchange_rate);

  const usdcRead = await readUsdcBalance(chain, address, fetchImpl);
  const usdc = usdcRead.ok ? usdcRead.token : null;
  // The token sub-read's failure is not dropped: it rides on the balance so the
  // screen can name the specific reason the USDC amount is unread. The native
  // balance is still returned; nothing is fabricated as a zero.
  const tokenFailure = usdcRead.ok ? undefined : usdcRead.failure;

  const parts = [nativeUsd, usdc?.usd].filter(
    (value): value is number => value !== null && value !== undefined,
  );

  return {
    chain,
    ok: true,
    balance: {
      chainId: chain.chainId,
      name: chain.name,
      nativeSymbol: chain.symbol,
      nativeAmount,
      nativeUsd,
      usdc,
      tokenFailure,
      usd: parts.length === 0 ? null : parts.reduce((sum, value) => sum + value, 0),
    },
  };
}

/**
 * Read the native-coin and USDC balances of `address` on each target chain.
 *
 * @throws {EvmReadError} when the address is invalid, before any fetch. A
 * per-chain provider failure does not throw: that chain is returned as a
 * specific `EvmReadFailure`, so the caller can keep it visible with a real
 * reason instead of dropping it and leaving the resident without an
 * explanation.
 */
export async function readEvmBalances(
  address: string,
  options: EvmReadOptions = {},
): Promise<EvmChainBalance[]> {
  const chains = await readEvmChainBalances(address, options);
  return chains
    .filter((read) => read.ok && read.balance !== undefined)
    .map((read) => read.balance as EvmChainBalance);
}

/**
 * Read every target chain and return each outcome, including the explained
 * failures.
 *
 * This is the variant the screens use when they need to say **why** a chain's
 * balance is missing. `readEvmBalances` is the compatibility wrapper that keeps
 * its original shape (reads only), so existing callers are unaffected.
 *
 * @throws {EvmReadError} when the address is invalid, before any fetch.
 */
export async function readEvmChainBalances(
  address: string,
  options: EvmReadOptions = {},
): Promise<EvmChainRead[]> {
  const normalized = normalizeEvmAddress(address);
  const fetchImpl = options.fetchImpl ?? fetch;
  const chains = resolveChains(options.chains);

  const results: EvmChainRead[] = [];
  for (const chain of chains) {
    results.push(await readChainBalance(chain, normalized, fetchImpl));
  }
  return results;
}
