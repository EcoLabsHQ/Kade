import type { Country, CountryCode } from '@kade/shared';
import { tokens } from '@/components/ui/tokens';
import { CountryBadge } from './CountryBadge';
import { CountrySelect } from './CountrySelect';

export interface CitizenshipEditorProps {
  readonly id: string;
  readonly citizenships: readonly CountryCode[];
  readonly options: readonly Country[];
  readonly onAdd: (code: CountryCode) => void;
  readonly onRemove: (index: number) => void;
  /** False when removing would leave no citizenship (frozen rule). */
  readonly removable: boolean;
  readonly getCountryName: (code: CountryCode) => string;
}

/** The reference's blue citizenship chips plus the "+ Add country" select. */
export function CitizenshipEditor({
  id,
  citizenships,
  options,
  onAdd,
  onRemove,
  removable,
  getCountryName,
}: CitizenshipEditorProps) {
  const removeTitle = removable
    ? 'Remove this citizenship'
    : 'At least one citizenship must remain.';

  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          fontSize: '12px',
          fontWeight: 600,
          color: tokens.muted,
          marginBottom: '6px',
        }}
      >
        Citizenships
      </label>
      <div
        style={{
          minHeight: '44px',
          border: `1px solid ${tokens.border}`,
          borderRadius: '10px',
          padding: '6px 8px',
          background: '#fff',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          alignItems: 'center',
        }}
      >
        {citizenships.map((code, index) => (
          <span
            key={code}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: tokens.activeNavBg,
              color: tokens.brandPrimary,
              fontSize: '12.5px',
              fontWeight: 600,
              padding: '5px 10px',
              borderRadius: '999px',
            }}
          >
            <CountryBadge code={code} />
            {getCountryName(code)}
            <button
              type="button"
              disabled={!removable}
              aria-label={`Remove ${getCountryName(code)} citizenship`}
              title={removeTitle}
              onClick={() => onRemove(index)}
              style={{
                border: 0,
                background: 'transparent',
                color: removable ? tokens.brandPrimary : tokens.locked,
                fontFamily: 'inherit',
                fontSize: '13px',
                cursor: removable ? 'pointer' : 'not-allowed',
                padding: '0 0 0 2px',
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </span>
        ))}
        <CountrySelect
          id={id}
          options={options}
          onSelect={onAdd}
          ariaLabel="Add citizenship"
        />
      </div>
    </div>
  );
}
