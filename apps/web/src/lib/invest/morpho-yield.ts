import { morphoVaultDeploymentForChain } from '@kade/shared';
import { checksumAddress } from './morpho-abi';

/**
 * The MetaMorpho vault's current yield, read from Morpho's public API.
 *
 * The Invest allocate modal's summary box shows an **Estimated income** figure.
 * That figure was deliberately `Not quoted` while no yield source was connected,
 * because quoting the design reference's demo APY would have been inventing a
 * number. The owner has now asked for it to be computed **from Morpho**, so this
 * module is the source: the vault the rail already pins, read from Morpho's
 * public Blue API (`https://blue-api.morpho.org/graphql`) — the same endpoint a
 * prior research task used to verify the vaults.
 *
 * The read is bounded and cached, not per-render:
 *
 *   - `next: { revalidate: MORPHO_YIELD_CACHE_SECONDS }` lets Next cache the
 *     response for a day, so a page render does not call Morpho every time;
 *   - a short `AbortSignal.timeout` bounds a hung request.
 *
 * Honesty rule (unchanged from the rest of the app): an unreadable figure must
 * look unread, never like a fact. If the API does not answer, answers non-200,
 * answers non-JSON, or answers a vault with no usable `netApy`, this returns the
 * ledger's `unknown` variant carrying the **specific reason** — never a zero and
 * never a guessed rate. A genuine `netApy: 0` is a real zero and is reported as
 * `known: 0`.
 *
 * This module is pure apart from the injected `fetch` read, so it is testable
 * offline with a stubbed read (see `invest-morpho-yield.test.ts`). It never
 * signs, builds or sends anything: it is a display-only read.
 */

/** The Morpho Blue API endpoint, the project's established source. */
export const MORPHO_API_URL = 'https://blue-api.morpho.org/graphql';

/**
 * How long Next may reuse a cached Morpho answer, in seconds (one day).
 *
 * The vault's APY moves slowly and the figure is a labelled **estimate**, so a
 * day-old rate is still honest; it keeps a page render from calling Morpho on
 * every request. Chosen as `[arbitrary]`, bounded rather than unbounded.
 */
export const MORPHO_YIELD_CACHE_SECONDS = 86_400;

/** [arbitrary] long enough to reach the API, short enough not to stall a render. */
const MORPHO_YIELD_TIMEOUT_MS = 5_000;

/** A real annual rate (as a fraction, e.g. `0.05` for 5%), or why it is unknown. */
export type MorphoYieldRead =
  | {
      readonly status: 'known';
      /** The vault's `netApy` as a fraction of one. `0` is a real zero. */
      readonly netApy: number;
    }
  | { readonly status: 'unknown'; readonly reason: string };

/**
 * A type guard for the `known` variant.
 *
 * Takes `null` too (the "no read supplied for this chain" case), so a caller can
 * pass an absent map entry and get `false` rather than crashing — the modal uses
 * it to choose between the real estimate and `Not quoted`.
 */
export function isMorphoYieldReadable(
  read: MorphoYieldRead | null | undefined,
): read is Extract<MorphoYieldRead, { status: 'known' }> {
  return read?.status === 'known';
}

/** The exact shape asked of the API; parsed strictly so junk cannot read as a fact. */
const VAULT_YIELD_QUERY = `query VaultYield($address: String!, $chainId: Int!) {
  vaultByAddress(address: $address, chainId: $chainId) {
    address
    state {
      netApy
    }
  }
}`;

/**
 * Parse the API body into a real rate, or the specific reason it is unusable.
 *
 * Deliberately strict: `netApy` must be a finite, non-negative number. A string,
 * a `null`, an object or `NaN` is refused with a reason rather than coerced —
 * coercion is exactly how a guessed number would slip in.
 */
function parseNetApy(body: unknown): MorphoYieldRead {
  const data =
    typeof body === 'object' && body !== null
      ? (body as { data?: unknown }).data
      : undefined;
  const vault =
    typeof data === 'object' && data !== null
      ? (data as { vaultByAddress?: unknown }).vaultByAddress
      : undefined;
  if (vault === null || vault === undefined) {
    return {
      status: 'unknown',
      reason: 'Morpho returned no vault for this address and chain.',
    };
  }
  const state =
    typeof vault === 'object'
      ? (vault as { state?: unknown }).state
      : undefined;
  const netApy =
    typeof state === 'object' && state !== null
      ? (state as { netApy?: unknown }).netApy
      : undefined;
  if (
    typeof netApy !== 'number' ||
    !Number.isFinite(netApy) ||
    netApy < 0
  ) {
    return {
      status: 'unknown',
      reason:
        'Morpho returned no usable net APY for this vault (the figure was ' +
        'missing or malformed).',
    };
  }
  return { status: 'known', netApy };
}

/**
 * Read the pinned vault's current yield for `chainId` from Morpho.
 *
 * The vault address is never a caller argument: it is resolved here from the
 * frozen registry (`@kade/shared`'s `METAMORPHO_VAULT_DEPLOYMENTS`), exactly as
 * the deposit rail resolves it, so the figure can only describe the vault the
 * rail actually deposits into. A chain with no pinned vault is refused.
 *
 * `fetchImpl` is the injected read (defaulting to the global `fetch`), so tests
 * drive it offline with no network.
 */
export async function readMorphoVaultYield(
  chainId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<MorphoYieldRead> {
  const deployment = morphoVaultDeploymentForChain(chainId);
  if (!deployment) {
    return {
      status: 'unknown',
      reason: `No MetaMorpho vault is pinned for chain ${chainId}, so no yield can be read.`,
    };
  }

  let vault: `0x${string}`;
  try {
    vault = checksumAddress(
      deployment.vault.value,
      `METAMORPHO_VAULT_DEPLOYMENTS[${chainId}].vault`,
    );
  } catch (cause) {
    return {
      status: 'unknown',
      reason: `The pinned vault address could not be read (${
        cause instanceof Error ? cause.message : String(cause)
      }).`,
    };
  }

  let response: Response;
  try {
    response = await fetchImpl(MORPHO_API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query: VAULT_YIELD_QUERY,
        variables: { address: vault, chainId },
      }),
      // Cached by Next for a day: a page render does not call Morpho every time.
      next: { revalidate: MORPHO_YIELD_CACHE_SECONDS },
      signal: AbortSignal.timeout(MORPHO_YIELD_TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      status: 'unknown',
      reason: `Morpho could not be reached (${
        cause instanceof Error ? cause.message : String(cause)
      }).`,
    };
  }

  if (!response.ok) {
    return {
      status: 'unknown',
      reason: `Morpho answered HTTP ${response.status} for this vault's yield.`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      status: 'unknown',
      reason: 'Morpho answered a body that was not valid JSON.',
    };
  }

  return parseNetApy(body);
}

/**
 * The vault's annual yield as a percentage of one, or `null` when it is unknown.
 *
 * A thin convenience for callers that only need the number; it never invents
 * one, so a failure stays `null` rather than becoming `0`.
 */
export async function readMorphoVaultNetApy(
  chainId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<number | null> {
  const read = await readMorphoVaultYield(chainId, fetchImpl);
  return read.status === 'known' ? read.netApy : null;
}
