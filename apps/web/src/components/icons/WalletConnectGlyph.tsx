/**
 * A simplified WalletConnect-style mark (two joined arcs), used on the
 * WalletConnect row badge. Demo asset: it is not the official logo.
 */
export function WalletConnectGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.9 9.4c3.92-3.9 10.28-3.9 14.2 0l.72.7a.85.85 0 0 1 0 1.22l-1.62 1.6a.47.47 0 0 1-.65 0l-.99-.98a4.83 4.83 0 0 0-6.72 0l-1.06 1.05a.47.47 0 0 1-.65 0l-1.56-1.55a.85.85 0 0 1 0-1.22l.98-.97Zm-1.9 3.6 1.5 1.49a.7.7 0 0 0 .98 0l1.06-1.05a2.4 2.4 0 0 1 3.34 0l1.06 1.05a.7.7 0 0 0 .98 0l1.06-1.05a2.4 2.4 0 0 1 3.34 0l1.06 1.05a.7.7 0 0 0 .98 0l1.5-1.49-1.5-1.48a4.5 4.5 0 0 0-6.28 0l-.52.52-.52-.52a4.5 4.5 0 0 0-6.28 0l-1.5 1.48Z" />
    </svg>
  );
}
