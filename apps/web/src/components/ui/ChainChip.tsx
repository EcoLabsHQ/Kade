import { tokens } from './tokens';

export interface ChainChipProps {
  readonly name: string;
  readonly color: string;
}

/** The reference's chain label: a small square swatch plus the chain name. */
export function ChainChip({ name, color }: ChainChipProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '7px',
        fontSize: '12.5px',
        color: tokens.chipFg,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '2px',
          background: color,
        }}
      />
      {name}
    </span>
  );
}
