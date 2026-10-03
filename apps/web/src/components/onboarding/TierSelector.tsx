import { TIERS, type TierIndex } from '@kade/shared';
import { tokens } from '@/components/ui/tokens';

export interface TierSelectorProps {
  readonly value: TierIndex | null;
  readonly onSelect: (index: TierIndex) => void;
  readonly invalid?: boolean;
}

function usd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

/** "Colosseum Resident" is rendered as "Colosseum" + "Resident" on two lines. */
function tierNameLines(name: string): readonly string[] {
  return name.split(' ');
}

/** The reference's tier cards, plus the Colosseum Resident demo tier. */
export function TierSelector({ value, onSelect, invalid }: TierSelectorProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Permit tier you are aiming for"
      aria-invalid={invalid || undefined}
      className="kade-grid-tiers"
      style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}
    >
      {TIERS.map((tier) => {
        const selected = value === tier.index;
        return (
          <button
            key={tier.index}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onSelect(tier.index)}
            style={{
              textAlign: 'left',
              background: '#fff',
              border: `1.5px solid ${
                selected
                  ? tokens.action
                  : invalid
                    ? tokens.danger
                    : tokens.border
              }`,
              borderRadius: '12px',
              padding: '12px 14px',
              fontFamily: 'inherit',
              cursor: 'pointer',
              color: tokens.ink,
            }}
          >
            <div style={{ fontSize: '14px', fontWeight: 700, color: tokens.ink }}>
              {tierNameLines(tier.name).map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
            <div
              style={{
                fontSize: '12px',
                color: tokens.muted,
                marginTop: '2px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {usd(tier.minUsdc)}
            </div>
          </button>
        );
      })}
    </div>
  );
}
