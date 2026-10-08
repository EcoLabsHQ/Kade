/**
 * The Ethereum mark, shown in the asset circle on a native ETH holding row.
 *
 * Artwork: `spothq/cryptocurrency-icons`, `svg/color/eth.svg`
 * (https://github.com/spothq/cryptocurrency-icons/blob/master/svg/color/eth.svg),
 * released under **CC0 1.0 Universal** — a public-domain dedication. The licence
 * was verified in the repository's own `LICENSE.md`
 * (https://github.com/spothq/cryptocurrency-icons/blob/master/LICENSE.md).
 *
 * Only the source's inner white mark is used: the app's own asset circle
 * supplies the background colour, so the mark is painted in `currentColor`
 * (matching `BitcoinGlyph` and the rest of the glyph set) rather than hardcoding
 * the source's brand colour. The source's 32-unit grid is scaled by 0.75 onto
 * this app's 24-unit glyph grid, so the path data is unchanged.
 *
 * Decorative: it sits beside the holding's text name, which carries the
 * accessible name, so the glyph is hidden from assistive technology.
 */
export function EthGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      data-testid="eth-glyph"
    >
      <g transform="scale(0.75)">
        <path fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z" />
        <path d="M16.498 4L9 16.22l7.498-3.35z" />
        <path fillOpacity=".602" d="M16.498 21.968v6.027L24 17.616z" />
        <path d="M16.498 27.995v-6.028L9 17.616z" />
        <path fillOpacity=".2" d="M16.498 20.573l7.497-4.353-7.497-3.348z" />
        <path fillOpacity=".602" d="M9 16.22l7.498 4.353v-7.701z" />
      </g>
    </svg>
  );
}
