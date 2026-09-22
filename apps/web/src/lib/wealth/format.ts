/** Presentation helpers shared by the proof-of-wealth surfaces. */

/** Format a USD figure for display, rounded to whole dollars. */
export function usd(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/** Shorten a long address for display; the full value belongs in `title`. */
export function shortAddress(address: string): string {
  return address.length <= 16
    ? address
    : `${address.slice(0, 8)}…${address.slice(-6)}`;
}
