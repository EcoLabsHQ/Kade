'use client';

import { useRef } from 'react';
import { tokens } from '@/components/ui/tokens';
import { GoogleGlyph } from './GoogleGlyph';

export type SignInMethod = 'google' | 'email';

export interface SignInMethodGroupProps {
  readonly value: SignInMethod;
  readonly onChange: (method: SignInMethod) => void;
  readonly disabled?: boolean;
  /** Only offered when the project reports the provider as enabled. */
  readonly available?: Readonly<Record<SignInMethod, boolean>>;
}

const OPTIONS: readonly {
  key: SignInMethod;
  title: string;
  subtitle: string;
}[] = [
  {
    key: 'google',
    title: 'Google',
    subtitle: 'Continue with your Google account',
  },
  {
    key: 'email',
    title: 'Email link',
    subtitle: 'A one-time sign-in link, no password',
  },
];

/**
 * The sign-in method selector.
 *
 * A real radio group, not two decorative cards: keyboard operable with arrow
 * keys, `role="radio"` with `aria-checked`, and a roving tabindex so Tab moves
 * through the group once. Selecting a method drives both the form below and the
 * single primary action outside the card.
 *
 * Styling follows the reference's method cards: 1fr 1fr grid, 10px gap, 14px/16px
 * padding, 12px radius, 1.5px blue border on the selected card.
 */
export function SignInMethodGroup({
  value,
  onChange,
  disabled = false,
  available,
}: SignInMethodGroupProps) {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  function move(from: SignInMethod, delta: number) {
    const enabled = OPTIONS.filter(
      (option) => available?.[option.key] ?? true,
    ).map((option) => option.key);
    if (enabled.length === 0) return;
    const index = enabled.indexOf(from);
    const next = enabled[(index + delta + enabled.length) % enabled.length];
    if (next) {
      onChange(next);
      refs.current[next]?.focus();
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Sign-in method"
      className="kade-grid-2"
      style={{ gap: '10px' }}
    >
      {OPTIONS.map((option) => {
        const selected = value === option.key;
        const enabled = (available?.[option.key] ?? true) && !disabled;

        return (
          <div
            key={option.key}
            ref={(node) => {
              refs.current[option.key] = node;
            }}
            role="radio"
            aria-checked={selected}
            aria-disabled={!enabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (enabled) onChange(option.key);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(option.key, 1);
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(option.key, -1);
              } else if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                if (enabled) onChange(option.key);
              }
            }}
            style={{
              border: selected
                ? `1.5px solid ${tokens.action}`
                : `1px solid ${tokens.border}`,
              background: '#fff',
              borderRadius: '12px',
              padding: '14px 16px',
              cursor: enabled ? 'pointer' : 'not-allowed',
              opacity: enabled ? 1 : 0.6,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '14px',
                fontWeight: 600,
                color: selected ? tokens.ink : tokens.chipFg,
              }}
            >
              {option.key === 'google' ? <GoogleGlyph size={18} /> : null}
              {option.title}
            </div>
            <div
              style={{
                fontSize: '12px',
                color: tokens.muted,
                marginTop: '2px',
              }}
            >
              {option.subtitle}
            </div>
          </div>
        );
      })}
    </div>
  );
}
