import type { VaultHoldingRow } from './vault-holdings';

/**
 * The **one** qualified total, and the **one** reduction that produces it.
 *
 * The qualified total is what the resident Safe actually holds on chain right
 * now. Nothing persists a vault position — the Invest Morpho deposit and the
 * Holdings "Move to vault" transfer write no row — so the only truthful source
 * is a fresh read of the Safe through {@link loadVaultHoldings}, reduced here.
 *
 * This module is deliberately *not* a reader. It is the single reduction over
 * the rows the existing reader already produces, so the two surfaces that show
 * the qualified total — the Holdings `QUALIFIED` card and the residency tier
 * check — cannot compute it two different ways:
 *
 *   - the Holdings page reads the rows once with `loadVaultHoldings` and reduces
 *     them once with {@link summarizeQualifiedPosition};
 *   - the residency snapshot reads the same Safe with the same reader and
 *     reduces it with the same function, and `ResidencyFacts.qualified` carries
 *     this exact value;
 *   - `HoldingsScreen` takes a `QualifiedPosition` prop, so the page's single
 *     result flows to the card rather than being recomputed there.
 *
 * Honesty rules, the same ones the rest of Holdings follows:
 *
 *   - no recorded Safe, or a Safe whose address is blank, is **unknown** with a
 *     specific reason — there is nowhere to read from, so no figure is invented;
 *   - a row whose read failed (`readError`) or whose value could not be valued
 *     (`usd === null`) makes the total **unknown** and carries the real,
 *     per-chain reason — never a partial sum presented as a total;
 *   - a successful read that found nothing is a real, **known `0`**, so the
 *     screen may say so.
 */

/** A real qualified figure, or the specific reason it could not be established. */
export type QualifiedPosition =
  | { readonly status: 'known'; readonly usd: number }
  | { readonly status: 'unknown'; readonly reason: string };

/** The reason when there is no recorded Safe to read a qualified position from. */
export const NO_SAFE_QUALIFIED_REASON =
  'No vault (Safe) is recorded for this account, so the qualified total could ' +
  'not be read.';

/** True for a null, non-string or blank Safe address. */
function isBlank(address: string | null | undefined): boolean {
  return typeof address !== 'string' || address.trim() === '';
}

/**
 * Reduce the Safe's on-chain rows to the one qualified total.
 *
 * `safeAddress` is part of the input because the reader returns an empty array
 * both for "the Safe holds nothing" and for "there is no Safe"; only the caller
 * knows which, and collapsing the two would report a fabricated `$0` for an
 * account with no vault.
 */
export function summarizeQualifiedPosition(input: {
  readonly safeAddress: string | null | undefined;
  readonly rows: readonly VaultHoldingRow[];
}): QualifiedPosition {
  if (isBlank(input.safeAddress)) {
    return { status: 'unknown', reason: NO_SAFE_QUALIFIED_REASON };
  }

  const unread = input.rows.filter(
    (row) =>
      row.readError !== null ||
      row.usd === null ||
      !Number.isFinite(row.usd),
  );
  if (unread.length > 0) {
    return {
      status: 'unknown',
      reason: unread
        .map(
          (row) =>
            `${row.chainName}: ${
              row.readError ??
              `the ${row.name} amount could not be valued in USD.`
            }`,
        )
        .join(' '),
    };
  }

  return {
    status: 'known',
    usd: input.rows.reduce((sum, row) => sum + (row.usd ?? 0), 0),
  };
}
