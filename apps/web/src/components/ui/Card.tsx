import type { CSSProperties, ReactNode } from 'react';
import { tokens } from './tokens';

export interface CardProps {
  readonly children: ReactNode;
  readonly padding?: string;
  readonly radius?: number;
  readonly style?: CSSProperties;
  readonly background?: string;
}

/** The reference's repeated surface panel. */
export function Card({
  children,
  padding = '22px 24px',
  radius = 16,
  style,
  background = tokens.surface,
}: CardProps) {
  return (
    <div
      style={{
        background,
        border: `1px solid ${tokens.border}`,
        borderRadius: radius,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
