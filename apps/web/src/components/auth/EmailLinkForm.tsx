'use client';

import { useEffect, useRef } from 'react';
import { tokens } from '@/components/ui/tokens';

export interface EmailLinkFormProps {
  readonly email: string;
  readonly onEmailChange: (email: string) => void;
  readonly error?: string | null;
  readonly disabled?: boolean;
}

/**
 * The email field, shown only while the email method is selected.
 *
 * On a validation failure the field is focused (the parent passes `error`), so
 * the resident does not have to hunt for what went wrong.
 */
export function EmailLinkForm({
  email,
  onEmailChange,
  error,
  disabled = false,
}: EmailLinkFormProps) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (error) input.current?.focus();
  }, [error]);

  return (
    <div>
      <label
        htmlFor="sign-in-email"
        style={{
          display: 'block',
          fontSize: '12px',
          fontWeight: 600,
          color: tokens.muted,
          marginBottom: '6px',
        }}
      >
        Email
      </label>
      <input
        id="sign-in-email"
        ref={input}
        type="email"
        name="email"
        inputMode="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        disabled={disabled}
        onChange={(event) => onEmailChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'sign-in-email-error' : undefined}
        style={{
          width: '100%',
          height: '46px',
          border: `1px solid ${error ? tokens.danger : tokens.border}`,
          borderRadius: '10px',
          padding: '0 14px',
          fontFamily: 'inherit',
          fontSize: '14.5px',
          background: disabled ? tokens.surface : '#fff',
          color: tokens.ink,
        }}
      />
      {error ? (
        <p
          id="sign-in-email-error"
          role="alert"
          style={{
            margin: '6px 0 0',
            fontSize: '12.5px',
            color: tokens.danger,
          }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
