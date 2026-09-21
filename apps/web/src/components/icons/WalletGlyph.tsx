/** A wallet outline, used on the browser-extension row badge. */
export function WalletGlyph({ size = 22 }: { size?: number }) {
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
    >
      <path d="M3.5 8.25A2.75 2.75 0 0 1 6.25 5.5H18a1 1 0 0 1 1 1v1.75" />
      <rect x="3.5" y="8.25" width="17" height="10.25" rx="2.5" />
      <path d="M16.25 13.4h2.25" />
    </svg>
  );
}
