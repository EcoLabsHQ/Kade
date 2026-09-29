'use client';

import type { CSSProperties } from 'react';
import { tokens } from './tokens';

/**
 * The in-flight state of a transaction: an animated indicator plus a sentence
 * naming the step it is on.
 *
 * It is announced to assistive technology (`role="status"`, polite live region)
 * and the spinner exposes a `progressbar`, so "something is happening and it is
 * not finished" is perceivable rather than only implied by a disabled button.
 */
export interface TransactionProgressProps {
  /** What the transaction is doing right now. */
  readonly label: string;
  /** The progressbar's accessible name; defaults to the visible label. */
  readonly progressLabel?: string;
}

export function TransactionProgress({
  label,
  progressLabel,
}: TransactionProgressProps) {
  return (
    <div role="status" aria-live="polite" style={row}>
      <span
        role="progressbar"
        aria-label={progressLabel ?? label}
        className="kade-spinner"
        style={spinner}
      />
      <span style={text}>{label}</span>
    </div>
  );
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  margin: '12px 0 0',
  padding: '10px 12px',
  background: tokens.surface,
  border: `1px solid ${tokens.border}`,
  borderRadius: '12px',
};

const spinner: CSSProperties = {
  width: '16px',
  height: '16px',
  flexShrink: 0,
  border: '2px solid rgba(16,24,40,.16)',
  borderTopColor: tokens.action,
  borderRadius: '999px',
};

const text: CSSProperties = {
  fontSize: '13px',
  lineHeight: 1.5,
  color: tokens.chipFg,
};
