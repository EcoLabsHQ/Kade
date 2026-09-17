import { tokens } from './tokens';

export interface StatCardProps {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  readonly valueColor?: string;
}

/**
 * The reference's dashboard stat panel: uppercase eyebrow, large value,
 * muted sub-line.
 */
export function StatCard({ label, value, sub, valueColor }: StatCardProps) {
  return (
    <div
      style={{
        background: tokens.surface,
        border: `1px solid ${tokens.border}`,
        borderRadius: 14,
        padding: '18px 20px',
      }}
    >
      <div
        style={{
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: tokens.muted,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '28px',
          fontWeight: 700,
          marginTop: '8px',
          fontVariantNumeric: 'tabular-nums',
          color: valueColor ?? tokens.ink,
        }}
      >
        {value}
      </div>
      {sub ? (
        <div style={{ fontSize: '12.5px', color: tokens.muted, marginTop: '2px' }}>
          {sub}
        </div>
      ) : null}
    </div>
  );
}
