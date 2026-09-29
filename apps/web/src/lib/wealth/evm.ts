import { chainByChainId, rpcEnvVarForChain } from '@kade/shared';
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
 * Server-side only: the browser never calls the provider. The **chain's own
 * JSON-RPC endpoint is the primary source**, so a flaky indexer cannot leave a
 * balance unread:
 *
 *   - `eth_getBalance` gives the native coin directly;
 *   - `eth_call` to the USDC contract's `balanceOf` gives the token balance.
 *
 * The provider's Blockscout endpoints are kept only as a fallback for a chain
 * with no RPC variable mapped:
 *
 *   - `GET /api/v2/addresses/{address}` returns `coin_balance` (a decimal string
 *     of wei);
 *   - `GET /api?module=account&action=balance&address={address}&tag=latest`
 *     returns the same balance from the Etherscan-compatible module API;
 *   - `GET /api?module=account&action=tokenbalance&contractaddress={usdc}
 *          &address={address}&tag=latest` returns the USDC balance.
 *
 * ETH is the native coin of every chain this app reads (Ethereum, Base, and
 * Arbitrum when it is added), so the ETH/USD price is read **once** from one
 * deliberately chosen provider (`/api/v2/stats` → `coin_price`) and applied to
 * every chain's native amount. A missing price never fails a balance read: the
 * real amount is shown and the USD value is left `null`, exactly as the Bitcoin
 * read does. USDC is never priced — it stays 1:1 with USD.
 *
 * The RPC endpoints come from the shared per-chain variable
 * (`rpcEnvVarForChain`). The chain list and `fetchImpl` are injectable, so tests
 * never touch the network.
 *
 * A read that fails once is not treated as a final answer: a transient status
 * (429, 408 or 5xx) or a thrown transport error is retried with bounded backoff,
 * within a per-chain time budget. A single endpoint can also be durably dead
 * (the observed Base `/api/v2/addresses` returns 500 for every request), which
 * is exactly why the RPC is primary and the provider is only a fallback. A final
 * failure is reported with a specific reason, so a resident sees *why* a balance
 * could not be read instead of a generic dead end — and a failed read is never
 * turned into a fabricated zero.
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
  /**
   * Optional per-chain JSON-RPC endpoint, the primary balance source.
   *
   * Production leaves this unset: the endpoint is then resolved from the shared
   * per-chain variable (`rpcEnvVarForChain`), so no URL is restated here. It is
   * injectable so a test can exercise the RPC read with no network and no
   * ambient environment.
   */
  readonly rpcUrl?: string;
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
 * The request is supplied as a thunk rather than a URL so a caller can send a
 * POST body (the RPC) without the retry policy knowing how the request is
 * shaped. A plain GET passes `() => fetchImpl(url)`, which keeps the call
 * signature the rest of the code and the tests already use.
 */
async function fetchWithRetry(
  request: () => Promise<Response>,
  chain: EvmReadChain,
): Promise<FetchOutcome> {
  let lastFailure: EvmReadFailure | null = null;
  const chainStartedAt = Date.now();

  for (let attempt = 1; attempt <= EVM_READ_ATTEMPTS; attempt += 1) {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    let response: Response;
    try {
      response = await Promise.race([
        Promise.resolve(request()),
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

/** True when the chain has a provider base to read from. */
function hasProviderBase(chain: EvmReadChain): boolean {
  return chain.baseUrl.trim() !== '';
}

/**
 * The one chain whose provider is asked for the ETH/USD price.
 *
 * ETH is native to every chain read here, so one price is correct for all of
 * them and asking each indexer for its own rate was both redundant and fragile.
 * Ethereum mainnet is the canonical ETH market and the chain least likely to
 * lag; when a caller supplies a list without it, the first chain with a provider
 * base is used instead.
 */
const PRICE_SOURCE_CHAIN_ID = 1;

/** Parse the provider's `coin_price` as a finite, positive USD rate. */
function parsePrice(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }
  if (typeof raw !== 'string') return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** The chain whose provider supplies the single ETH/USD price. */
function priceSourceChain(
  chains: readonly EvmReadChain[],
): EvmReadChain | null {
  return (
    chains.find(
      (chain) => chain.chainId === PRICE_SOURCE_CHAIN_ID && hasProviderBase(chain),
    ) ??
    chains.find(hasProviderBase) ??
    null
  );
}

/**
 * The one ETH/USD price, or null when it cannot be read.
 *
 * A missing price must never fail a balance read (the precedent is the Bitcoin
 * read): the caller applies this to every chain's native amount and leaves the
 * USD figure null when it is absent. The source is the single chosen provider's
 * dedicated stats endpoint (`coin_price`), not an address summary — that is the
 * endpoint that was durably dead on Base, and it is not needed just for a rate.
 * Uses the same bounded retry as every other provider request, and never throws.
 */
async function readEthUsdPrice(
  chains: readonly EvmReadChain[],
  fetchImpl: typeof fetch,
): Promise<number | null> {
  const source = priceSourceChain(chains);
  if (!source) return null;

  const base = source.baseUrl.replace(/\/+$/, '');
  const outcome = await fetchWithRetry(
    () => fetchImpl(`${base}/api/v2/stats`),
    source,
  );
  if ('failure' in outcome) return null;

  try {
    const body = (await outcome.response.json()) as {
      coin_price?: unknown;
    } | null;
    return parsePrice(body?.coin_price);
  } catch {
    return null;
  }
}

/** A native-balance source outcome: the real wei, or a classified failure. */
type NativeReadOutcome =
  | { readonly ok: true; readonly wei: bigint }
  | { readonly ok: false; readonly failure: EvmReadFailure };

/** A USDC source outcome: the real raw amount, or a classified failure. */
type UsdcReadOutcome =
  | { readonly ok: true; readonly raw: bigint }
  | { readonly ok: false; readonly failure: EvmReadFailure };

/**
 * Parse a decimal quantity (wei) from a provider body.
 *
 * Strict on purpose: only an unsigned decimal integer is accepted. In
 * particular an empty string does **not** become `0n` (`BigInt('')` is `0n`),
 * so a malformed body can never be read as a zero balance.
 */
function parseDecimalQuantity(raw: unknown): bigint | null {
  if (typeof raw === 'number') {
    return Number.isInteger(raw) && raw >= 0 ? BigInt(raw) : null;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? BigInt(trimmed) : null;
}

/** Parse a JSON-RPC hex quantity (`0x…`), or null when it is not one. */
function parseHexQuantity(raw: unknown): bigint | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return /^0x[0-9a-fA-F]+$/.test(trimmed) ? BigInt(trimmed) : null;
}

/**
 * The JSON-RPC endpoint for a chain: the injected `rpcUrl` when present (tests),
 * otherwise the shared per-chain variable (`BASE_RPC_URL`, `ETHEREUM_RPC_URL`,
 * …). Null when neither is configured, so a missing endpoint is skipped rather
 * than used as a fabricated endpoint.
 */
function resolveRpcUrl(chain: EvmReadChain): string | null {
  const explicit = chain.rpcUrl?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const variable = rpcEnvVarForChain(chain.chainId);
  if (!variable) return null;
  return process.env[variable]?.trim() || null;
}

/**
 * The chain's own `eth_getBalance` — the primary native source.
 *
 * Authoritative and indexer-independent, which is why it comes first: a dead
 * Blockscout `v2` endpoint can no longer leave a Base balance unread. Returns
 * null when no RPC endpoint is configured, so a chain without one falls through
 * to the provider rather than failing here.
 */
async function readNativeFromRpc(
  chain: EvmReadChain,
  address: string,
  fetchImpl: typeof fetch,
): Promise<NativeReadOutcome | null> {
  const rpcUrl = resolveRpcUrl(chain);
  if (!rpcUrl) return null;

  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_getBalance',
    params: [address, 'latest'],
  });

  const outcome = await fetchWithRetry(
    () =>
      fetchImpl(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      }),
    chain,
  );
  if ('failure' in outcome) return { ok: false, failure: outcome.failure };

  let body: { result?: unknown; error?: unknown } | null;
  try {
    body = (await outcome.response.json()) as {
      result?: unknown;
      error?: unknown;
    } | null;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, failure: failureForBody(chain, detail) };
  }

  if (body?.error !== undefined && body.error !== null) {
    return {
      ok: false,
      failure: failureForBody(chain, 'the RPC returned an error'),
    };
  }

  const wei = parseHexQuantity(body?.result);
  if (wei === null) {
    return {
      ok: false,
      failure: failureForBody(chain, 'no native balance was present'),
    };
  }
  return { ok: true, wei };
}

/**
 * The provider's address summary — the first native fallback.
 *
 * Used only when the RPC could not answer (or is not configured). Returns null
 * when the chain has no provider base, so its absence is not a read failure.
 * The summary also carries `exchange_rate`, which is deliberately ignored: the
 * one ETH/USD price is read once for every chain, not per chain.
 */
async function readNativeFromProviderSummary(
  chain: EvmReadChain,
  address: string,
  fetchImpl: typeof fetch,
): Promise<NativeReadOutcome | null> {
  if (!hasProviderBase(chain)) return null;

  const base = chain.baseUrl.replace(/\/+$/, '');
  const outcome = await fetchWithRetry(
    () => fetchImpl(`${base}/api/v2/addresses/${address}`),
    chain,
  );
  if ('failure' in outcome) return { ok: false, failure: outcome.failure };

  let body: { coin_balance?: unknown } | null;
  try {
    body = (await outcome.response.json()) as {
      coin_balance?: unknown;
    } | null;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, failure: failureForBody(chain, detail) };
  }

  const wei = parseDecimalQuantity(body?.coin_balance);
  if (wei === null) {
    return {
      ok: false,
      failure: failureForBody(chain, 'no native balance was present'),
    };
  }
  return { ok: true, wei };
}

/**
 * The provider's Etherscan-compatible module API — the second native fallback.
 *
 * Needs no configuration beyond the provider base and answers when the summary
 * endpoint is dead. Returns null when the chain has no provider base.
 */
async function readNativeFromModuleApi(
  chain: EvmReadChain,
  address: string,
  fetchImpl: typeof fetch,
): Promise<NativeReadOutcome | null> {
  if (!hasProviderBase(chain)) return null;

  const base = chain.baseUrl.replace(/\/+$/, '');
  const url =
    `${base}/api?module=account&action=balance` +
    `&address=${address}&tag=latest`;

  const outcome = await fetchWithRetry(() => fetchImpl(url), chain);
  if ('failure' in outcome) return { ok: false, failure: outcome.failure };

  let body: { status?: unknown; message?: unknown; result?: unknown } | null;
  try {
    body = (await outcome.response.json()) as {
      status?: unknown;
      message?: unknown;
      result?: unknown;
    } | null;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, failure: failureForBody(chain, detail) };
  }

  // A provider-declared failure (`status` "0") is not a zero balance: it is
  // refused with the provider's own message so it cannot be read as one.
  if (body?.status !== undefined && String(body.status) !== '1') {
    const detail =
      typeof body.message === 'string' && body.message.trim() !== ''
        ? body.message
        : 'the provider reported a failed balance read';
    return { ok: false, failure: failureForBody(chain, detail) };
  }

  const wei = parseDecimalQuantity(body?.result);
  if (wei === null) {
    return {
      ok: false,
      failure: failureForBody(chain, 'no native balance was present'),
    };
  }
  return { ok: true, wei };
}

/**
 * Read the native balance from the first source that answers.
 *
 * Source order: chain RPC (`eth_getBalance`) → provider summary → provider
 * module API. The RPC is primary because it is authoritative and
 * indexer-independent; the provider endpoints remain only as a fallback for a
 * chain with no RPC variable mapped. When every source fails, the provider
 * summary's failure is reported when it exists (it is the specific reason the
 * resident already sees), otherwise the module API's, then the RPC's; a chain
 * with no source at all is `no-endpoint`. Nothing is fabricated as a zero.
 */
async function readNativeBalance(
  chain: EvmReadChain,
  address: string,
  fetchImpl: typeof fetch,
): Promise<NativeReadOutcome> {
  const rpcRead = await readNativeFromRpc(chain, address, fetchImpl);
  if (rpcRead?.ok) return { ok: true, wei: rpcRead.wei };

  const summaryRead = await readNativeFromProviderSummary(chain, address, fetchImpl);
  if (summaryRead?.ok) return { ok: true, wei: summaryRead.wei };

  const moduleRead = await readNativeFromModuleApi(chain, address, fetchImpl);
  if (moduleRead?.ok) return { ok: true, wei: moduleRead.wei };

  if (summaryRead && !summaryRead.ok) return { ok: false, failure: summaryRead.failure };
  if (moduleRead && !moduleRead.ok) return { ok: false, failure: moduleRead.failure };
  if (rpcRead && !rpcRead.ok) return { ok: false, failure: rpcRead.failure };
  return { ok: false, failure: failureForNoEndpoint(chain) };
}

/** USDC's `balanceOf(address)` selector, the first four bytes of its hash. */
const ERC20_BALANCE_OF_SELECTOR = '0x70a08231';

/** Encode an address as the single ABI word argument of `balanceOf`. */
function encodeBalanceOf(address: string): string {
  return `${ERC20_BALANCE_OF_SELECTOR}${address
    .slice(2)
    .toLowerCase()
    .padStart(64, '0')}`;
}

/**
 * The USDC balance from the chain's own RPC, via `eth_call` `balanceOf` — the
 * primary token source, for the same reason the native read uses the RPC.
 * Returns null when no RPC endpoint is configured.
 */
async function readUsdcFromRpc(
  chain: EvmReadChain,
  address: string,
  fetchImpl: typeof fetch,
): Promise<UsdcReadOutcome | null> {
  const rpcUrl = resolveRpcUrl(chain);
  if (!rpcUrl) return null;

  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to: chain.usdcAddress, data: encodeBalanceOf(address) }, 'latest'],
  });

  const outcome = await fetchWithRetry(
    () =>
      fetchImpl(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      }),
    chain,
  );
  if ('failure' in outcome) return { ok: false, failure: outcome.failure };

  let body: { result?: unknown; error?: unknown } | null;
  try {
    body = (await outcome.response.json()) as {
      result?: unknown;
      error?: unknown;
    } | null;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, failure: failureForBody(chain, detail) };
  }

  if (body?.error !== undefined && body.error !== null) {
    return {
      ok: false,
      failure: failureForBody(chain, 'the RPC returned an error'),
    };
  }

  const raw = parseHexQuantity(body?.result);
  if (raw === null) {
    return {
      ok: false,
      failure: failureForBody(chain, 'no token balance was present'),
    };
  }
  return { ok: true, raw };
}

/**
 * The USDC balance from the provider's module API — the fallback for a chain
 * with no RPC. Returns null when the chain has no provider base.
 */
async function readUsdcFromProvider(
  chain: EvmReadChain,
  address: string,
  fetchImpl: typeof fetch,
): Promise<UsdcReadOutcome | null> {
  if (!hasProviderBase(chain)) return null;

  const base = chain.baseUrl.replace(/\/+$/, '');
  const url =
    `${base}/api?module=account&action=tokenbalance` +
    `&contractaddress=${chain.usdcAddress}&address=${address}&tag=latest`;

  const outcome = await fetchWithRetry(() => fetchImpl(url), chain);
  if ('failure' in outcome) return { ok: false, failure: outcome.failure };

  let body: { result?: unknown } | null;
  try {
    body = (await outcome.response.json()) as { result?: unknown } | null;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, failure: failureForBody(chain, detail) };
  }

  const raw = parseDecimalQuantity(body?.result);
  if (raw === null) {
    return {
      ok: false,
      failure: failureForBody(chain, 'no token balance was present'),
    };
  }
  return { ok: true, raw };
}

/** Format a raw USDC amount as the 1:1 dollar-valued token balance. */
function tokenFromRaw(raw: bigint): EvmTokenBalance {
  const amount = formatUnits(raw, USDC_DECIMALS);
  // USDC is a dollar: its USD value is its amount. The contract is not the
  // price source, but the peg is what the product relies on and the DOCX
  // treats USDC as 1:1 with USD. No price is ever looked up for it.
  return { symbol: 'USDC', amount, usd: Number(amount) };
}

/**
 * Read the USDC balance for the chain's known contract.
 *
 * RPC `balanceOf` first, then the provider module API. Returns the balance, or a
 * **classified** `EvmReadFailure` when every source fails, so the caller can
 * name the specific reason rather than silently reporting a missing token. A
 * missing token balance is never fabricated as zero.
 */
async function readUsdcBalance(
  chain: EvmReadChain,
  address: string,
  fetchImpl: typeof fetch,
): Promise<
  | { readonly ok: true; readonly token: EvmTokenBalance }
  | { readonly ok: false; readonly failure: EvmReadFailure }
> {
  const rpcRead = await readUsdcFromRpc(chain, address, fetchImpl);
  if (rpcRead?.ok) return { ok: true, token: tokenFromRaw(rpcRead.raw) };

  const providerRead = await readUsdcFromProvider(chain, address, fetchImpl);
  if (providerRead?.ok) return { ok: true, token: tokenFromRaw(providerRead.raw) };

  if (providerRead && !providerRead.ok) {
    return { ok: false, failure: providerRead.failure };
  }
  if (rpcRead && !rpcRead.ok) return { ok: false, failure: rpcRead.failure };
  return { ok: false, failure: failureForNoEndpoint(chain) };
}

/**
 * Read one chain's native coin and USDC balances.
 *
 * The native balance is read from the first source that answers (see
 * `readNativeBalance`) and valued with the single `ethUsd` rate shared by every
 * chain. A missing price leaves `nativeUsd` (and the chain's `usd` when there is
 * no USDC either) null without failing the read, exactly as the Bitcoin read
 * does.
 *
 * A chain where every source failed is reported as a specific `EvmReadFailure`
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
  ethUsd: number | null,
): Promise<EvmChainRead> {
  const native = await readNativeBalance(chain, address, fetchImpl);
  if (!native.ok) return { chain, ok: false, failure: native.failure };

  const nativeAmount = formatNative(native.wei);
  const nativeUsd = toUsd(nativeAmount, ethUsd);

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
 * per-chain read failure does not throw: that chain is returned as a specific
 * `EvmReadFailure`, so the caller can keep it visible with a real reason instead
 * of dropping it and leaving the resident without an explanation.
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

  // Read the one ETH/USD price before the per-chain loop, so it is fetched once
  // and applied to every chain rather than once per chain.
  const ethUsd = await readEthUsdPrice(chains, fetchImpl);

  const results: EvmChainRead[] = [];
  for (const chain of chains) {
    results.push(await readChainBalance(chain, normalized, fetchImpl, ethUsd));
  }
  return results;
}
