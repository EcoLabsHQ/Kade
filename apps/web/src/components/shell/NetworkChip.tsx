import { tokens } from '@/components/ui/tokens';

export interface NetworkChipProps {
  readonly label: string;
  readonly dotColor?: string;
}

/** The reference's sidebar network chip: a small dot plus the active chain. */
export function NetworkChip({ label, dotColor = '#627EEA' }: NetworkChipProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        background: tokens.chipBg,
        color: tokens.chipFg,
        fontSize: '11px',
        fontWeight: 700,
        padding: '4px 9px',
        borderRadius: '999px',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: dotColor,
        }}
      />
      {label}
    </span>
  );
}
