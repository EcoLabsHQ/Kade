import type { Country, CountryCode } from '@kade/shared';
import { tokens } from '@/components/ui/tokens';

export interface CountrySelectProps {
  readonly id: string;
  readonly options: readonly Country[];
  readonly onSelect: (code: CountryCode) => void;
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly title?: string;
}

/**
 * The reference's dashed "+ Add country" pill. It is a `<select>` over the
 * frozen 14-country list; its value is always empty so choosing the same
 * country twice is impossible.
 */
export function CountrySelect({
  id,
  options,
  onSelect,
  label = '+ Add country',
  ariaLabel,
  disabled,
  title,
}: CountrySelectProps) {
  return (
    <select
      id={id}
      aria-label={ariaLabel ?? label}
      value=""
      disabled={disabled}
      title={title}
      onChange={(event) => {
        if (event.target.value === '') return;
        onSelect(event.target.value as CountryCode);
      }}
      style={{
        border: '1px dashed #C6D2E0',
        background: '#fff',
        color: tokens.chipFg,
        fontFamily: 'inherit',
        fontSize: '12.5px',
        fontWeight: 600,
        padding: '5px 8px',
        borderRadius: '999px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        outline: 'none',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <option value="">{label}</option>
      {options.map((country) => (
        <option key={country.code} value={country.code}>
          {country.name}
        </option>
      ))}
    </select>
  );
}
