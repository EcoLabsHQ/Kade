import Image from 'next/image';

export interface LogoProps {
  readonly height?: number;
}

/**
 * The official Onchain Island wordmark.
 *
 * The asset is copied into the app's own `public/` rather than imported from
 * `reference/`: `reference/` is documentation and is never loaded at runtime,
 * but the brand mark itself is required by the design spec.
 */
export function Logo({ height = 26 }: LogoProps) {
  return (
    <Image
      src="/onchain-island-logo.png"
      alt="Onchain Island"
      width={115}
      height={36}
      priority
      style={{ height, width: 'auto', display: 'block' }}
    />
  );
}
