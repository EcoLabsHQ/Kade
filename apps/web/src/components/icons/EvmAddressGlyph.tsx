/**
 * A compact "0x" mark for the watch-only wallet-address row badge.
 *
 * Drawn geometrically (a rounded zero and a crossed x) rather than as text, so
 * it stays legible at 22px without depending on a loaded font.
 */
export function EvmAddressGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3.5" y="7.25" width="7.5" height="9.5" rx="3.75" />
      <path d="M14.75 8.75l5 6.5M19.75 8.75l-5 6.5" />
    </svg>
  );
}
