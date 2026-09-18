import { tokens } from '@/components/ui/tokens';

export interface CountryBadgeProps {
  readonly code: string;
}

/** The reference's country-code badge: 22x16, `rgba(16,24,40,.08)`, 10px/700. */
export function CountryBadge({ code }: CountryBadgeProps) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '22px',
        height: '16px',
        borderRadius: '3px',
        background: 'rgba(16,24,40,.08)',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '.02em',
        color: tokens.chipFg,
        flex: '0 0 auto',
      }}
    >
      {code}
    </span>
  );
}
