import type { CSSProperties, ReactNode } from 'react';
import { tokens } from './tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'locked';

export interface ButtonProps {
  readonly children: ReactNode;
  readonly variant?: ButtonVariant;
  readonly type?: 'button' | 'submit';
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly title?: string;
  /** An explicit accessible name, when the visible text is not stable enough. */
  readonly ariaLabel?: string;
  readonly style?: CSSProperties;
  readonly fullWidth?: boolean;
  /** Associates the button with a form it is not nested inside. */
  readonly form?: string;
}

const base: CSSProperties = {
  height: '46px',
  padding: '0 22px',
  borderRadius: '999px',
  fontFamily: 'inherit',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
};

const variants: Record<ButtonVariant, CSSProperties> = {
  primary: {
    background: tokens.action,
    color: '#fff',
    border: '0',
  },
  secondary: {
    background: '#fff',
    color: tokens.ink,
    border: `1px solid ${tokens.border}`,
  },
  locked: {
    background: tokens.locked,
    color: '#fff',
    border: '0',
    cursor: 'not-allowed',
  },
};

export function Button({
  children,
  variant = 'primary',
  type = 'button',
  disabled,
  onClick,
  title,
  ariaLabel,
  style,
  fullWidth,
  form,
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      form={form}
      style={{
        ...base,
        ...variants[variant],
        ...(fullWidth ? { width: '100%' } : null),
        ...style,
      }}
    >
      {children}
    </button>
  );
}
