/** The Bitcoin mark (a drawn ₿), used on the network-read Bitcoin badge. */
export function BitcoinGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9.25 5.2v13.6" />
      <path d="M11.4 3.5v1.7M11.4 18.8v1.7" />
      <path d="M9.25 5.7h4.1a2.65 2.65 0 0 1 0 5.3h-4.1" />
      <path d="M9.25 11h4.75a2.9 2.9 0 0 1 0 5.8h-4.75" />
    </svg>
  );
}
