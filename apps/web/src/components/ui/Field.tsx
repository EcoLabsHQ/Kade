import type { ChangeEvent } from 'react';
import { tokens } from './tokens';

export interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
  readonly type?: 'text' | 'date' | 'email';
  readonly onChange?: (value: string) => void;
  readonly hint?: string;
}

/** Labelled text field, matching the reference's 44px input style. */
export function Field({
  id,
  label,
  value,
  placeholder,
  readOnly,
  type = 'text',
  onChange,
  hint,
}: FieldProps) {
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
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={
          onChange
            ? (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)
            : undefined
        }
        style={{
          width: '100%',
          height: '44px',
          border: `1px solid ${tokens.border}`,
          borderRadius: '10px',
          padding: '0 14px',
          fontSize: '14.5px',
          background: readOnly ? tokens.surface : '#fff',
          color: tokens.ink,
          outline: 'none',
        }}
      />
      {hint ? (
        <div style={{ fontSize: '11.5px', color: tokens.muted, marginTop: '6px' }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
