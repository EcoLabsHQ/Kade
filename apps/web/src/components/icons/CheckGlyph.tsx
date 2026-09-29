/**
 * A confirmation tick, shown in place of the copy glyph once a copy succeeds.
 * Paired with a "Copied …" accessible name so the state is not conveyed by the
 * glyph or its colour alone.
 */
export function CheckGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-testid="check-glyph"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
