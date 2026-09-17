import type { CSSProperties, ReactNode } from 'react';
import { tokens } from './tokens';

export type ChipTone =
  | 'neutral'
  | 'brand'
  | 'active'
  | 'success'
  | 'warning'
  | 'danger'
  | 'muted';

const tones: Record<ChipTone, { bg: string; fg: string }> = {
  neutral: { bg: tokens.chipBg, fg: tokens.chipFg },
  brand: { bg: tokens.activeNavBg, fg: tokens.brandPrimary },
  active: { bg: tokens.activeNavBg, fg: tokens.brandPrimary },
  success: { bg: '#EAF6F0', fg: tokens.success },
  warning: { bg: '#FDF6E7', fg: tokens.warning },
  danger: { bg: '#FEF3F2', fg: tokens.danger },
  muted: { bg: tokens.chipBg, fg: tokens.muted },
};

export interface ChipProps {
  readonly children: ReactNode;
  readonly tone?: ChipTone;
  readonly dot?: boolean;
  readonly dotColor?: string;
  readonly style?: CSSProperties;
}

/** The reference's repeated pill / status chip. */
export function Chip({
  children,
  tone = 'neutral',
  dot = false,
  dotColor,
  style,
}: ChipProps) {
  const palette = tones[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        background: palette.bg,
        color: palette.fg,
        fontSize: '11px',
        fontWeight: 700,
        padding: '4px 9px',
        borderRadius: '999px',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {dot ? (
        <span
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: dotColor ?? palette.fg,
          }}
        />
      ) : null}
      {children}
    </span>
  );
}
