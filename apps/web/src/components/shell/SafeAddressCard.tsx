import { tokens } from '@/components/ui/tokens';

export interface SafeAddressCardProps {
  /** Null until a Safe is actually deployed. Never a fabricated address. */
  readonly address: string | null;
  readonly network?: string;
}

/**
 * The reference's Safe account card.
 *
 * Deliverable C: do not fabricate a deployed address. When no address has been
 * supplied, render `0x…` (an obvious placeholder) and state that the address
 * is not yet available.
 */
export function SafeAddressCard({
  address,
  network = 'Ethereum Sepolia',
}: SafeAddressCardProps) {
  const hasAddress = address !== null && address.length > 0;
  return (
    <div
      style={{
        background: tokens.surface,
        border: `1px solid ${tokens.border}`,
        borderRadius: '12px',
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
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
      <div style={{ minWidth: 0 }}>
        <div
          title={
            hasAddress
              ? 'Deployed Safe address'
              : 'No Safe has been deployed in this environment; the address is withheld rather than fabricated'
          }
          style={{
            fontSize: '12.5px',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            color: hasAddress ? tokens.ink : tokens.muted,
          }}
        >
          {hasAddress ? address : '0x…'}
        </div>
        <div style={{ fontSize: '11px', color: tokens.muted }}>
          Safe · {hasAddress ? network : 'not deployed'} · {network}
        </div>
      </div>
    </div>
  );
}
