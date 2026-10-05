import {
  GENDER_VALUES,
  RELATION_VALUES,
  householdMemberDob,
  type Country,
  type CountryCode,
} from '@kade/shared';
import { DatePicker } from '@/components/ui/DatePicker';
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
  readonly invalid?: boolean;
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

/** A relation that is not one of the three accepted values (legacy text). */
function isLegacyRelation(value: string): boolean {
  return value !== '' && !(RELATION_VALUES as readonly string[]).includes(value);
}

/**
 * The shared message for an entered date of birth, or null when it is empty or
 * valid. The rule lives in `@kade/shared`; this only reads its message, so the
 * form cannot disagree with the schema that blocks Continue. There is no 18+
 * floor any more: only impossible and future dates are rejected.
 */
function memberDobError(dob: string): string | null {
  if (dob === '') return null;
  const parsed = householdMemberDob.safeParse(dob);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
}

/**
 * Household member rows.
 *
 * The handoff shows each member as a display-only row (name · relation, then
 * DOB · citizenship) with a single "+ Add member". The contract requires these
 * values to be entered and persisted, so each row here is an editable form with
 * a remove control. The visual language (30px initials badge, relation and
 * citizenship on the muted line) is kept.
 *
 * Relation is a strict dropdown (Spouse / Partner / Child). A legacy value that
 * is not one of those is shown as-is with a message and keeps the member from
 * saving until it is re-selected; `Son`/`Daughter` are mapped to `Child` on load
 * by the loader, so they never reach here as legacy text.
 */
export function HouseholdEditor({
  members,
  options,
  onAdd,
  onRemove,
  onUpdate,
  invalid,
}: HouseholdEditorProps) {
  return (
    <div
      style={{
        background: tokens.surface,
        border: `1px solid ${invalid ? tokens.danger : tokens.border}`,
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

      {members.map((member, index) => {
        const legacyRelation = isLegacyRelation(member.relation);
        return (
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
                <select
                  aria-label={`Household member ${index + 1} relation`}
                  aria-invalid={legacyRelation || undefined}
                  value={member.relation}
                  onChange={(event) =>
                    onUpdate(index, { relation: event.target.value })
                  }
                  style={{
                    ...controlStyle,
                    borderColor: legacyRelation ? tokens.danger : tokens.border,
                  }}
                >
                  <option value="">Select relation</option>
                  {legacyRelation ? (
                    <option value={member.relation}>{member.relation}</option>
                  ) : null}
                  {RELATION_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                {legacyRelation ? (
                  <span
                    style={{
                      display: 'block',
                      fontSize: '11.5px',
                      color: tokens.danger,
                      marginTop: '4px',
                    }}
                  >
                    Choose Spouse, Partner or Child to continue.
                  </span>
                ) : null}
              </label>
              <label style={{ display: 'block' }}>
                <span style={labelStyle}>Gender</span>
                <select
                  aria-label={`Household member ${index + 1} gender`}
                  value={member.gender}
                  onChange={(event) =>
                    onUpdate(index, { gender: event.target.value })
                  }
                  style={controlStyle}
                >
                  <option value="">Select gender</option>
                  {GENDER_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ gridColumn: 'span 2' }}>
                <DatePicker
                  id={`household-member-${index + 1}-dob`}
                  label="Date of birth"
                  triggerAriaLabel={`Household member ${index + 1} date of birth`}
                  value={member.dob}
                  invalid={memberDobError(member.dob) !== null}
                  error={memberDobError(member.dob) ?? undefined}
                  emptyViewYearsAgo={member.relation === 'Child' ? 16 : 40}
                  onChange={(iso) => onUpdate(index, { dob: iso })}
                />
              </div>
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
        );
      })}

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
