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
 * write. The wait is bounded by {@link READ_SOURCE_CATCHUP_DELAYS_MS}; when the
 * source never catches up the caller revalidates anyway (`not-seen`) rather than
 * hanging the success path.
 *
 * The endpoint is resolved from the same per-chain variable the read uses
 * (`rpcEnvVarForChain`), never a restated URL, so the wait targets exactly the
 * source whose lag caused the stale render. Every dependency is injectable, so
 * the mechanism is testable with no network and no real timer.
 */

/**
 * The bounded backoff schedule for the read source.
 *
 * [arbitrary] The first poll is immediate, so a source that is already caught up
 * pays one round-trip and no sleep. The schedule then caps the extra wait at
 * ~7.75 s — long enough for a load-balanced endpoint to advance one or two
 * blocks, short enough that the resident's confirmed screen is not held for the
 * 30 s the receipt poll itself already allows.
 */
export const READ_SOURCE_CATCHUP_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000] as const;

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
}

/**
 * The outcome of the wait.
 *
 *   - `seen` — the read source served the confirmed transaction, so a render
 *     now reads the post-write state.
 *   - `not-seen` — the bounded schedule was exhausted; the caller still
 *     revalidates, because a manual reload and the client's own refresh remain
 *     the fallback.
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
 * One `eth_getTransactionReceipt` poll.
 *
 * A transport error, a malformed body or an RPC error is "not yet" — the source
 * may be transiently unreachable, and the schedule already bounds the wait. It
 * is never reported as `seen`, so the caller cannot mistake a failed poll for a
 * caught-up source.
 */
async function readSourceSeesTransaction(
  rpcUrl: string,
  transactionHash: Hex,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [transactionHash],
      }),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as {
      result?: unknown;
      error?: unknown;
    } | null;
    if (body?.error !== undefined && body.error !== null) return false;
    return body?.result !== undefined && body.result !== null;
  } catch {
    return false;
  }
}

/**
 * Poll the read source until it serves `transactionHash`, or the schedule ends.
 *
 * The first poll is immediate; each subsequent poll follows one backoff delay.
 * Returns `unavailable` before any poll when there is nothing to wait on.
 */
export async function waitForReadSourceToSeeTransaction(
  input: ReadSourceCatchupInput,
  deps: ReadSourceCatchupDeps = {},
): Promise<ReadSourceCatchupOutcome> {
  const transactionHash = input.transactionHash ?? null;
  if (transactionHash === null) return 'unavailable';

  const rpcUrl = resolveRpcUrl(input.chainId, deps.rpcUrl);
  if (!rpcUrl) return 'unavailable';

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return 'unavailable';
  const sleep = deps.sleep ?? defaultSleep;

  if (await readSourceSeesTransaction(rpcUrl, transactionHash, fetchImpl)) {
    return 'seen';
  }
  for (const delayMs of READ_SOURCE_CATCHUP_DELAYS_MS) {
    await sleep(delayMs);
    if (await readSourceSeesTransaction(rpcUrl, transactionHash, fetchImpl)) {
      return 'seen';
    }
  }
  return 'not-seen';
}
