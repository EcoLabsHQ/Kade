import type { CSSProperties, ReactNode } from 'react';
import { tokens } from './tokens';

export const lockedStyle: CSSProperties = {
  background: tokens.locked,
  color: '#fff',
  border: '0',
  cursor: 'not-allowed',
};

export interface LockedActionProps {
  readonly children: ReactNode;
  readonly reason?: string;
  readonly style?: CSSProperties;
  readonly height?: number;
}

/**
 * A control that is deliberately unavailable. Contract section 9 excludes the
 * wallet/asset features from Week 1, so they render locked rather than absent.
 */
export function LockedAction({
  children,
  reason = 'Not available in Week 1',
  style,
  height = 46,
}: LockedActionProps) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={reason}
      style={{
        height: `${height}px`,
        padding: '0 22px',
        borderRadius: '999px',
        fontFamily: 'inherit',
        fontSize: '15px',
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...lockedStyle,
        ...style,
      }}
    >
      {children}
    </button>
  );
}
