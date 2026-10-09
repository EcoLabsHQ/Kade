import { rpcEnvVarForChain } from '@kade/shared';
import type { Hex } from 'viem';

/**
 * Wait for the route's **read source** to observe a confirmed transaction.
 *
 * The confirmation that makes the Invest screen report success comes from the
 * **bundler** (`getUserOperationReceipt` in `@/lib/safe/execute-safe-4337`),
 * while the position the screen renders is read from the chain's own JSON-RPC
 * endpoint (`@/lib/wealth/vault-holdings`, `@/lib/wealth/evm`). Those are
 * different providers, and the app's endpoint is a load-balanced one, so it can
 * still be a block behind the bundler at the moment the receipt is confirmed.
 *
 * A `router.refresh()` / `revalidatePath('/invest')` issued immediately then
 * re-renders a `force-dynamic` route whose `eth_call`/`eth_getBalance` at
 * `latest` predates the deposit: the screen shows the pre-deposit position even
 * though the refresh did fire. A fast confirmation makes that race *more* likely,
 * not less.
 *
 * This helper closes the race honestly: it polls the **same endpoint the read
 * uses** until it can serve the confirmed transaction's receipt, then reports
 * `seen`. Only then does the caller revalidate, so the re-render reflects the
 * write.
 *
 * ## The wait is bounded, including a hung endpoint
 *
 * The transaction has **already succeeded** when this runs, so the resident must
 * not be held. The wait is bounded on two axes:
 *
 *   - **Per attempt** by {@link READ_SOURCE_CATCHUP_ATTEMPT_TIMEOUT_MS}: each
 *     `fetch` races a ceiling and carries an `AbortSignal`, so an endpoint that
 *     accepts the connection and never answers is abandoned rather than held
 *     until undici's default timeout (~300 s).
 *   - **In total** by {@link READ_SOURCE_CATCHUP_TOTAL_TIMEOUT_MS}: a deadline
 *     caps the sum of attempts and sleeps, so the whole wait can never exceed it
 *     even if every attempt hangs.
 *
 * A timeout is treated exactly like every other non-seen case: it falls through
 * to revalidation, never throws and never turns a confirmed success into a
 * failure. When the source never catches up the caller revalidates anyway
 * (`not-seen`) rather than hanging the success path.
 *
 * The endpoint is resolved from the same per-chain variable the read uses
 * (`rpcEnvVarForChain`), never a restated URL, so the wait targets exactly the
 * source whose lag caused the stale render. Every dependency is injectable, so
 * the mechanism is testable with no network and no real timer.
 *
 * Known residual (deliberately not closed here): the wait proves the read
 * endpoint *can* serve the transaction, but a non-sticky load balancer could
 * still route the following render's `eth_call` to a lagging backend. Closing
 * that means pinning the position read to the confirmed block; it is a bounded
 * follow-up, not part of this wait.
 */

/**
 * The bounded backoff schedule for the read source.
 *
 * [arbitrary] The first poll is immediate, so a source that is already caught up
 * pays one round-trip and no sleep. The sleeps then pace the retries; the
 * **total** wait is capped separately by
 * {@link READ_SOURCE_CATCHUP_TOTAL_TIMEOUT_MS}, so this schedule only decides
 * how the attempts are spread inside that ceiling.
 */
export const READ_SOURCE_CATCHUP_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;

/**
 * Per-attempt ceiling for one `eth_getTransactionReceipt` poll.
 *
 * [arbitrary] 1.5 s. This is a single cheap read on the same provider as the
 * position read, and it is only reached when the endpoint has accepted the
 * connection but not answered; a responsive endpoint settles in well under it.
 * The same "a hung provider must not hang the server render" rule the balance
 * read encodes (`EVM_READ_TIMEOUT_MS` in `@/lib/wealth/evm`) applies here, but
 * the catch-up wait runs **after** the transaction is already confirmed, so it
 * abandons a stalled attempt faster than a balance read would.
 */
export const READ_SOURCE_CATCHUP_ATTEMPT_TIMEOUT_MS = 1_500;

/**
 * Overall ceiling for the whole wait, attempts and sleeps included.
 *
 * [arbitrary] 8 s, deliberately the same magnitude as the repo's existing read
 * ceiling (`EVM_READ_TIMEOUT_MS`): long enough for a load-balanced endpoint to
 * advance one or two blocks, short enough that a resident whose transaction has
 * already succeeded is never left waiting longer than a single read budget. Once
 * the deadline passes the loop stops and the caller revalidates immediately.
 */
export const READ_SOURCE_CATCHUP_TOTAL_TIMEOUT_MS = 8_000;

/** What the wait targets: the chain, and the confirmed transaction's hash. */
export interface ReadSourceCatchupInput {
  readonly chainId: number;
  /** The mined transaction hash from the confirmed outcome; null when absent. */
  readonly transactionHash: Hex | null | undefined;
}

/** Injectable seams, so no test touches the network or a real timer. */
export interface ReadSourceCatchupDeps {
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /**
   * The endpoint to poll. Defaults to the chain's own RPC variable; `null`
   * forces the "no endpoint" path. Injected by tests.
   */
  readonly rpcUrl?: string | null;
  /** Per-attempt ceiling; defaults to {@link READ_SOURCE_CATCHUP_ATTEMPT_TIMEOUT_MS}. */
  readonly attemptTimeoutMs?: number;
  /** Overall ceiling; defaults to {@link READ_SOURCE_CATCHUP_TOTAL_TIMEOUT_MS}. */
  readonly totalTimeoutMs?: number;
}

/**
 * The outcome of the wait.
 *
 *   - `seen` — the read source served the confirmed transaction, so a render
 *     now reads the post-write state.
 *   - `not-seen` — the schedule or the total deadline was reached; the caller
 *     still revalidates, because a manual reload and the client's own refresh
 *     remain the fallback.
 *   - `unavailable` — there is no transaction hash or no read endpoint to poll,
 *     so there is nothing to wait on.
 */
export type ReadSourceCatchupOutcome = 'seen' | 'not-seen' | 'unavailable';

/** Real wall-clock sleep; injected away in tests so no timer runs. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Resolve the chain's own read endpoint, or null when it is not configured. */
function resolveRpcUrl(
  chainId: number,
  override: string | null | undefined,
): string | null {
  if (override !== undefined) return override;
  const variable = rpcEnvVarForChain(chainId);
  if (!variable) return null;
  return process.env[variable]?.trim() || null;
}

/**
 * One `eth_getTransactionReceipt` poll, bounded by `timeoutMs`.
 *
 * The request races a ceiling and carries an `AbortSignal`, so an endpoint that
 * accepts the connection and never answers is abandoned instead of holding the
 * caller. The `AbortSignal` cancels the real socket; the race guarantees the
 * `await` is bounded even if an injected `fetch` ignores the signal.
 *
 * A timeout, a transport error, a malformed body or an RPC error is "not yet" —
 * the source may be transiently unreachable. It is never reported as `seen`, so
 * the caller cannot mistake a failed poll for a caught-up source, and this
 * function never throws.
 */
async function readSourceSeesTransaction(
  rpcUrl: string,
  transactionHash: Hex,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Cancel the real request, then reject the race so the await is bounded
      // even if the request ignored the signal.
      controller.abort();
      reject(new Error(`read-source poll timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchImpl(rpcUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getTransactionReceipt',
          params: [transactionHash],
        }),
        signal: controller.signal,
      }),
      timedOut,
    ]);
    if (!response.ok) return false;
    const body = (await response.json()) as {
      result?: unknown;
      error?: unknown;
    } | null;
    if (body?.error !== undefined && body.error !== null) return false;
    return body?.result !== undefined && body.result !== null;
  } catch {
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Poll the read source until it serves `transactionHash`, or the ceiling is hit.
 *
 * The first poll is immediate; each subsequent poll follows one backoff delay.
 * Both the individual attempts and the sum of attempts plus sleeps are bounded,
 * so the call always returns in at most `totalTimeoutMs`. Returns `unavailable`
 * before any poll when there is nothing to wait on, and never throws.
 */
export async function waitForReadSourceToSeeTransaction(
  input: ReadSourceCatchupInput,
  deps: ReadSourceCatchupDeps = {},
): Promise<ReadSourceCatchupOutcome> {
  const candidate = input.transactionHash ?? null;
  if (candidate === null) return 'unavailable';
  // Rebind so the narrowed non-null hash survives into the `poll` closure.
  const transactionHash: Hex = candidate;

  const resolvedRpcUrl = resolveRpcUrl(input.chainId, deps.rpcUrl);
  if (!resolvedRpcUrl) return 'unavailable';
  const rpcUrl: string = resolvedRpcUrl;

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return 'unavailable';
  const sleep = deps.sleep ?? defaultSleep;
  const attemptTimeoutMs =
    deps.attemptTimeoutMs ?? READ_SOURCE_CATCHUP_ATTEMPT_TIMEOUT_MS;
  const totalTimeoutMs = deps.totalTimeoutMs ?? READ_SOURCE_CATCHUP_TOTAL_TIMEOUT_MS;

  // One deadline over the whole wait: attempts and sleeps both draw on it, so
  // the total can never exceed it even when every attempt hangs.
  const deadline = Date.now() + totalTimeoutMs;

  async function poll(): Promise<boolean> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    return readSourceSeesTransaction(
      rpcUrl,
      transactionHash,
      fetchImpl,
      Math.min(attemptTimeoutMs, remaining),
    );
  }

  if (await poll()) return 'seen';
  for (const delayMs of READ_SOURCE_CATCHUP_DELAYS_MS) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(delayMs, remaining));
    if (await poll()) return 'seen';
  }
  return 'not-seen';
}
