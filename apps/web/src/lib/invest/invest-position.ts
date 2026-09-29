import type { InvestVaultSummary } from '@/app/invest/actions';
import type { VaultHoldingRow } from '@/lib/wealth/vault-holdings';

/**
 * The Invest screen's *one* position read, reduced to what the screen renders.
 *
 * The Invest screen has a single source of truth for the resident Safe's
 * position: the rows produced by {@link loadVaultHoldings} — the same on-chain
 * reader the Holdings screen uses, pointed at the Safe. The route calls it
 * **once** and hands the rows to the screen; this module is the pure reduction
 * from those rows to the three things the screen needs:
 *
 *   1. the free USDC the Safe holds (the "Vault USDC available" figure);
 *   2. the Safe's position in the MetaMorpho vaults (the "allocated" figure);
 *   3. per chain, whether the Safe holds that rail's instrument — so a row can
 *      show `Allocate` or the real held amount.
 *
 * There is deliberately no second read and no stored position: nothing persists
 * a vault position, so the rows are the only truthful source, and this module
 * never invents a figure. A failed read stays a **specific reason**, never a
 * fabricated `0`: the honesty rules are the reader's, carried through here.
 *
 * The module is pure and offline — it takes plain rows as input, so it is
 * directly testable with no network.
 */

/** A real figure, or the specific reason it could not be read. Never a zero. */
export type AmountRead =
  | { readonly status: 'known'; readonly usd: number }
  | { readonly status: 'unknown'; readonly reason: string };

/** The Safe's position in one configured rail, as a row renders it. */
export type ChainPosition =
  | { readonly status: 'held'; readonly usd: number }
  | { readonly status: 'empty' }
  | { readonly status: 'unknown'; readonly reason: string };

/** Everything the Invest screen derives from the one position read. */
export interface InvestPosition {
  /** Free USDC the Safe holds, summed across every chain the read covers. */
  readonly freeUsdc: AmountRead;
  /** The Safe's position in the MetaMorpho vaults, summed across the rails. */
  readonly allocated: AmountRead;
  /** Per configured rail, whether the Safe holds that chain's instrument. */
  readonly byChain: ReadonlyMap<number, ChainPosition>;
  /**
   * Free USDC per chain, for the allocate preview's "Vault USDC after" — the
   * deposit draws from the row's own chain, so the preview is per chain.
   */
  readonly freeByChain: ReadonlyMap<number, AmountRead>;
  /** How many configured rails the Safe holds a position on. */
  readonly heldCount: number;
}

/** The reason shown when there is no Safe to read a position from. */
export const NO_SAFE_POSITION_REASON =
  'No Safe is recorded for this account, so its vault position could not be ' +
  'read.';

/** True for a null, non-string or blank address. */
function isBlank(address: string | null | undefined): boolean {
  return typeof address !== 'string' || address.trim() === '';
}

/**
 * Sum the rows' USD values into one real figure — or refuse if any row's value
 * is itself unknown, so a partial sum can never be presented as a total.
 */
function sumUsd(rows: readonly VaultHoldingRow[]): AmountRead {
  let total = 0;
  for (const row of rows) {
    if (row.usd === null) {
      return {
        status: 'unknown',
        reason: `${row.chainName}: the ${row.name} value could not be valued in USD.`,
      };
    }
    total += row.usd;
  }
  return { status: 'known', usd: total };
}

/** The specific reason(s) a chain's balance went unread, named by chain. */
function reasonFromUnread(rows: readonly VaultHoldingRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.chainName}: ${row.readError ?? 'the balance could not be read.'}`,
    )
    .join(' ');
}

/** The specific reason(s) a vault position went unread, named by chain. */
function reasonFromMorpho(rows: readonly VaultHoldingRow[]): string {
  return rows
    .map(
      (row) =>
        `${row.chainName}: ${row.readError ?? 'the vault position could not be read.'}`,
    )
    .join(' ');
}

/**
 * Reduce the Safe's on-chain holdings to the Invest screen's position.
 *
 * A blank Safe address means there is nowhere to read from: every figure is
 * `unknown` with the reason, and no rail is claimed to hold anything. With a
 * Safe, the rows are authoritative:
 *
 *   - a chain row the read did not produce is an `unread` row carrying its real
 *     reason, so the free-USDC total and that chain's preview become `unknown`
 *     rather than a zero;
 *   - a Morpho row with a `readError` makes the allocated total `unknown` and
 *     that rail's position `unknown`, with the real reason;
 *   - a Morpho row with an amount is a real `held` position;
 *   - a configured rail with no Morpho row is a genuine empty position (the
 *     reader emits no row for a successful read that found nothing).
 */
export function summarizeInvestPosition(input: {
  readonly holdings: readonly VaultHoldingRow[];
  readonly safeAddress: string | null;
  readonly vaults: readonly InvestVaultSummary[];
}): InvestPosition {
  const configured = input.vaults.filter((rail) => rail.configured);
  const byChain = new Map<number, ChainPosition>();
  const freeByChain = new Map<number, AmountRead>();

  if (isBlank(input.safeAddress)) {
    for (const rail of configured) {
      byChain.set(rail.chainId, {
        status: 'unknown',
        reason: NO_SAFE_POSITION_REASON,
      });
      freeByChain.set(rail.chainId, {
        status: 'unknown',
        reason: NO_SAFE_POSITION_REASON,
      });
    }
    return {
      freeUsdc: { status: 'unknown', reason: NO_SAFE_POSITION_REASON },
      allocated: { status: 'unknown', reason: NO_SAFE_POSITION_REASON },
      byChain,
      freeByChain,
      heldCount: 0,
    };
  }

  const unread = input.holdings.filter((row) => row.kind === 'unread');
  const usdcRows = input.holdings.filter((row) => row.kind === 'usdc');
  const morphoRows = input.holdings.filter((row) => row.kind === 'morpho');

  // Free USDC: any unread chain means the total is incomplete, so it is
  // `unknown` with the real reason rather than a total that silently omits it.
  const freeUsdc: AmountRead =
    unread.length > 0
      ? { status: 'unknown', reason: reasonFromUnread(unread) }
      : sumUsd(usdcRows);

  // Allocated: a failed vault read means the total is incomplete for the same
  // reason; only a fully-read set can be summed.
  const failedMorpho = morphoRows.filter((row) => row.readError !== null);
  const allocated: AmountRead =
    failedMorpho.length > 0
      ? { status: 'unknown', reason: reasonFromMorpho(failedMorpho) }
      : sumUsd(morphoRows);

  let heldCount = 0;
  for (const rail of configured) {
    const morpho = morphoRows.find((row) => row.chainId === rail.chainId);
    if (!morpho) {
      // A successful read that found no shares emits no row: genuinely empty.
      byChain.set(rail.chainId, { status: 'empty' });
    } else if (morpho.readError !== null) {
      byChain.set(rail.chainId, {
        status: 'unknown',
        reason: morpho.readError,
      });
    } else {
      byChain.set(rail.chainId, { status: 'held', usd: morpho.usd ?? 0 });
      heldCount += 1;
    }

    const unreadChain = unread.find((row) => row.chainId === rail.chainId);
    if (unreadChain) {
      freeByChain.set(rail.chainId, {
        status: 'unknown',
        reason:
          unreadChain.readError ??
          `The Safe's USDC on ${unreadChain.chainName} could not be read.`,
      });
    } else {
      const usdc = usdcRows.find((row) => row.chainId === rail.chainId);
      freeByChain.set(rail.chainId, { status: 'known', usd: usdc?.usd ?? 0 });
    }
  }

  return { freeUsdc, allocated, byChain, freeByChain, heldCount };
}
