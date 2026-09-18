import type { Country, CountryCode } from '@kade/shared';
import { tokens } from '@/components/ui/tokens';
import type { HouseholdMemberDraft } from '@/lib/onboarding/draft';
import { InitialsBadge } from './InitialsBadge';

export interface HouseholdEditorProps {
  readonly members: readonly HouseholdMemberDraft[];
  readonly options: readonly Country[];
  readonly onAdd: () => void;
  readonly onRemove: (index: number) => void;
  readonly onUpdate: (
    index: number,
    patch: Partial<HouseholdMemberDraft>,
  ) => void;
}

const labelStyle = {
  display: 'block',
  fontSize: '11px',
  fontWeight: 600,
  color: tokens.muted,
  marginBottom: '4px',
} as const;

const controlStyle = {
  width: '100%',
  height: '38px',
  border: `1px solid ${tokens.border}`,
  borderRadius: '8px',
  padding: '0 10px',
  fontSize: '13.5px',
  background: '#fff',
  color: tokens.ink,
  outline: 'none',
} as const;

/**
 * Household member rows.
 *
 * The handoff shows each member as a display-only row (name · relation, then
 * DOB · citizenship) with a single "+ Add member". The contract requires these
 * values to be entered and persisted, so each row here is an editable form with
 * a remove control. The visual language (30px initials badge, relation and
 * citizenship on the muted line) is kept.
 */
export function HouseholdEditor({
  members,
  options,
  onAdd,
  onRemove,
  onUpdate,
}: HouseholdEditorProps) {
  return (
    <div
      style={{
        background: tokens.surface,
        border: `1px solid ${tokens.border}`,
        borderRadius: '16px',
        padding: '22px 24px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '14px',
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
          Household
        </div>
        <button
          type="button"
          onClick={onAdd}
          style={{
            border: 0,
            background: 'transparent',
            fontFamily: 'inherit',
            fontSize: '13px',
            fontWeight: 600,
            color: tokens.action,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          + Add member
        </button>
      </div>

      {members.length === 0 ? (
        <div
          style={{
            borderTop: `1px solid ${tokens.border}`,
            paddingTop: '12px',
            fontSize: '12.5px',
            color: tokens.muted,
            lineHeight: 1.6,
          }}
        >
          No household members yet. You are the applicant, so the household size
          is 1 until you add someone.
        </div>
      ) : null}

      {members.map((member, index) => (
        <div
          key={index}
          style={{
            borderTop: `1px solid ${tokens.border}`,
            paddingTop: '12px',
            marginTop: '12px',
            display: 'grid',
            gridTemplateColumns: '30px 1fr auto',
            gap: '10px',
            alignItems: 'start',
            animation: 'fadeUp .2s ease-out',
          }}
        >
          <div style={{ paddingTop: '18px' }}>
            <InitialsBadge name={member.name} index={index} />
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
            }}
          >
            <label style={{ display: 'block', gridColumn: 'span 2' }}>
              <span style={labelStyle}>Full name</span>
              <input
                type="text"
                aria-label={`Household member ${index + 1} name`}
                value={member.name}
                onChange={(event) => onUpdate(index, { name: event.target.value })}
                style={controlStyle}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={labelStyle}>Relation</span>
              <input
                type="text"
                aria-label={`Household member ${index + 1} relation`}
                value={member.relation}
                placeholder="Spouse, Son, Daughter…"
                onChange={(event) =>
                  onUpdate(index, { relation: event.target.value })
                }
                style={controlStyle}
              />
            </label>
            <label style={{ display: 'block' }}>
              <span style={labelStyle}>Date of birth</span>
              <input
                type="date"
                aria-label={`Household member ${index + 1} date of birth`}
                value={member.dob}
                onChange={(event) => onUpdate(index, { dob: event.target.value })}
                style={controlStyle}
              />
            </label>
            <label style={{ display: 'block', gridColumn: 'span 2' }}>
              <span style={labelStyle}>Citizenship</span>
              <select
                aria-label={`Household member ${index + 1} citizenship`}
                value={member.citizenship}
                onChange={(event) =>
                  onUpdate(index, {
                    citizenship: event.target.value as CountryCode | '',
                  })
                }
                style={controlStyle}
              >
                <option value="">Select country</option>
                {options.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            aria-label={`Remove household member ${index + 1}`}
            title="Remove this household member"
            onClick={() => onRemove(index)}
            style={{
              border: 0,
              background: 'transparent',
              color: tokens.muted,
              fontFamily: 'inherit',
              fontSize: '16px',
              cursor: 'pointer',
              padding: '16px 0 0',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      ))}

      <div
        style={{
          marginTop: '14px',
          fontSize: '12px',
          color: tokens.muted,
          lineHeight: 1.6,
        }}
      >
        Immediate family receive permits of the same duration — no extra
        investment. Documents (passports, certificates) are uploaded after
        pre-approval.
      </div>
    </div>
  );
}
