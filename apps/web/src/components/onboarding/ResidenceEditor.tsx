import type { Country, CountryCode, Residence } from '@kade/shared';
import { tokens } from '@/components/ui/tokens';
import { CountryBadge } from './CountryBadge';
import { CountrySelect } from './CountrySelect';
import { RESIDENCE_YEARS_BACK } from '@/lib/onboarding/draft';

export interface ResidenceEditorProps {
  readonly id: string;
  readonly residences: readonly Residence[];
  readonly options: readonly Country[];
  readonly currentYear: number;
  readonly onAdd: (code: CountryCode) => void;
  readonly onRemove: (index: number) => void;
  readonly onUpdate: (
    index: number,
    patch: Partial<Pick<Residence, 'fromYear' | 'toYear'>>,
  ) => void;
  readonly getCountryName: (code: CountryCode) => string;
}

function yearRange(residence: Residence): string {
  return `${residence.fromYear}–${
    residence.toYear === 'present' ? 'now' : residence.toYear
  }`;
}

/**
 * The reference's residence chips, extended with year-range selectors.
 *
 * The handoff renders the year range as static seed text ("2016–now"); this
 * build adds the two selects the applicant needs to enter it, because the
 * frozen contract requires the five-year window to be *validated*, not seeded.
 */
export function ResidenceEditor({
  id,
  residences,
  options,
  currentYear,
  onAdd,
  onRemove,
  onUpdate,
  getCountryName,
}: ResidenceEditorProps) {
  const years: number[] = [];
  for (let year = currentYear; year >= currentYear - RESIDENCE_YEARS_BACK; year -= 1) {
    years.push(year);
  }

  return (
    <div style={{ gridColumn: 'span 2' }}>
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
        Countries of residence (last 5 years)
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
        {residences.map((residence, index) => (
          <span
            key={`${residence.countryCode}-${residence.fromYear}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: tokens.chipBg,
              color: tokens.chipFg,
              fontSize: '12.5px',
              fontWeight: 600,
              padding: '5px 10px',
              borderRadius: '999px',
            }}
          >
            <CountryBadge code={residence.countryCode} />
            {getCountryName(residence.countryCode)}
            <span style={{ fontWeight: 500, color: tokens.muted }}>
              {yearRange(residence)}
            </span>
            <button
              type="button"
              aria-label={`Remove ${getCountryName(residence.countryCode)} residence`}
              onClick={() => onRemove(index)}
              style={{
                border: 0,
                background: 'transparent',
                color: tokens.muted,
                fontFamily: 'inherit',
                fontSize: '13px',
                cursor: 'pointer',
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
          ariaLabel="Add residence country"
        />
      </div>
      <div
        style={{ fontSize: '11.5px', color: tokens.muted, marginTop: '6px' }}
      >
        Each residence country needs a police clearance later — listing them now
        means nothing is missed.
      </div>

      {residences.map((residence, index) => (
        <div
          key={`years-${residence.countryCode}-${residence.fromYear}`}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            marginTop: '8px',
          }}
        >
          <label style={{ display: 'block' }}>
            <span
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 600,
                color: tokens.muted,
                marginBottom: '4px',
              }}
            >
              {getCountryName(residence.countryCode)} · from
            </span>
            <select
              aria-label={`From year for ${getCountryName(residence.countryCode)}`}
              value={residence.fromYear}
              onChange={(event) =>
                onUpdate(index, { fromYear: Number(event.target.value) })
              }
              style={{
                width: '100%',
                height: '38px',
                border: `1px solid ${tokens.border}`,
                borderRadius: '8px',
                padding: '0 10px',
                fontSize: '13.5px',
                background: '#fff',
                color: tokens.ink,
                fontVariantNumeric: 'tabular-nums',
                outline: 'none',
              }}
            >
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <span
              style={{
                display: 'block',
                fontSize: '11px',
                fontWeight: 600,
                color: tokens.muted,
                marginBottom: '4px',
              }}
            >
              {getCountryName(residence.countryCode)} · to
            </span>
            <select
              aria-label={`To year for ${getCountryName(residence.countryCode)}`}
              value={
                residence.toYear === 'present' ? 'present' : residence.toYear
              }
              onChange={(event) => {
                const raw = event.target.value;
                onUpdate(index, {
                  toYear: raw === 'present' ? 'present' : Number(raw),
                });
              }}
              style={{
                width: '100%',
                height: '38px',
                border: `1px solid ${tokens.border}`,
                borderRadius: '8px',
                padding: '0 10px',
                fontSize: '13.5px',
                background: '#fff',
                color: tokens.ink,
                fontVariantNumeric: 'tabular-nums',
                outline: 'none',
              }}
            >
              <option value="present">now</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        </div>
      ))}
    </div>
  );
}
