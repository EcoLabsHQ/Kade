/**
 * The Invest allocate modal's minimum allocation.
 *
 * The owner set the minimum to **`$1`**: a resident may allocate any positive
 * USDC amount from one dollar up. This is the **single source of truth** for
 * that figure across the Invest surfaces.
 *
 * It exists because the minimum is stated in more than one place — the
 * instrument table's `Minimum` column, the allocate modal's summary box, and the
 * preset/default amount the modal seeds — and those surfaces previously drifted
 * (a card that said one figure beside copy that said another is exactly the
 * two-truths defect this iteration removed). Every surface now derives its copy
 * from this constant, so no later edit can reintroduce a disagreement: change it
 * here and every statement changes together.
 *
 * The value is intentionally **not** a percentage or a per-rail parameter: it is
 * one flat USDC floor for the MetaMorpho rails this iteration wires.
 */

/**
 * The minimum allocation, in whole USDC, for the wired MetaMorpho rails.
 *
 * `1` — the owner's chosen floor. Kept numeric so a caller can compare an amount
 * against it rather than parse a formatted string.
 */
export const MIN_ALLOCATION_USDC = 1;

/**
 * The one display string every surface renders for the minimum.
 *
 * Derived from {@link MIN_ALLOCATION_USDC}, so the label and the number cannot
 * disagree. The format matches the reference's `investMin` (`$1`).
 */
export function minimumAllocationLabel(): string {
  return `$${MIN_ALLOCATION_USDC.toLocaleString('en-US')}`;
}

/**
 * The default amount the allocate modal seeds, in whole USDC.
 *
 * The reference seeds `Math.max(10000, min)`; with the owner's `$1` floor that
 * would seed `10000`, which is a real, valid amount and matches the reference's
 * default. It is derived from {@link MIN_ALLOCATION_USDC}, so the default can
 * never fall below the minimum.
 */
export function defaultAllocationUsdc(): number {
  return Math.max(10_000, MIN_ALLOCATION_USDC);
}
