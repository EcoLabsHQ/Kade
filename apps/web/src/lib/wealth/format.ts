/** Presentation helpers shared by the proof-of-wealth surfaces. */

/** Format a USD figure for display, rounded to whole dollars. */
export function usd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/**
 * Format a USD figure for display with exactly two decimals.
 *
 * Rounds for presentation only: a caller that compares a balance against a tier
 * threshold must keep using the unrounded value. Kept separate from `usd`, whose
 * whole-dollar output other screens and tests depend on.
 */
export function usd2(value: number): string {
  return `$${usdc2(value)}`;
}

/**
 * Format a USDC amount with exactly two decimals and no currency symbol, so it
 * can sit before an explicit `USDC` unit without doubling the symbol. Shares
 * `usd2`'s two-decimal presentation.
 */
export function usdc2(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Shorten a long address for display; the full value belongs in `title`. */
export function shortAddress(address: string): string {
  return address.length <= 16
    ? address
    : `${address.slice(0, 8)}…${address.slice(-6)}`;
}
