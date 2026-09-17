import { tokens } from '@/components/ui/tokens';

/**
 * Text wordmark.
 *
 * The reference ships a raster wordmark; because the reference is
 * documentation only and is never imported, this is a text recreation rather
 * than the original asset.
 */
export function Logo() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        textDecoration: 'none',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '22px',
          height: '22px',
          borderRadius: '50%',
          background: `linear-gradient(135deg, ${tokens.brandPrimary}, #8FC2FF)`,
          flex: '0 0 auto',
        }}
      />
      <span
        style={{
          fontSize: '16px',
          fontWeight: 700,
          letterSpacing: '-.01em',
          color: tokens.ink,
        }}
      >
        Onchain Island
      </span>
    </span>
  );
}
