import type { CSSProperties, ReactNode } from 'react';
import { tokens } from './tokens';

export type NoticeTone = 'info' | 'warning' | 'error' | 'success' | 'neutral';

const tones: Record<NoticeTone, { bg: string; border: string; fg: string }> = {
  info: { bg: tokens.activeNavBg, border: tokens.action, fg: tokens.brandPrimary },
  warning: { bg: '#FDF6E7', border: tokens.warning, fg: tokens.warning },
  error: { bg: '#FEF3F2', border: tokens.danger, fg: tokens.danger },
  success: { bg: '#EAF6F0', border: tokens.success, fg: tokens.success },
  neutral: { bg: tokens.surface, border: tokens.border, fg: tokens.chipFg },
};

export interface NoticeProps {
  readonly children: ReactNode;
  readonly tone?: NoticeTone;
  readonly title?: string;
  readonly style?: CSSProperties;
}

/**
 * A small inline notice surface. The reference expresses these as tinted boxes
 * with a coloured edge; this keeps that language for the onboarding states.
 */
export function Notice({
  children,
  tone = 'neutral',
  title,
  style,
}: NoticeProps) {
  const palette = tones[tone];
  return (
    <div
      role="status"
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: '12px',
        padding: '12px 14px',
        ...style,
      }}
    >
      {title ? (
        <div
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            color: palette.fg,
          }}
        >
          {title}
        </div>
      ) : null}
      <div
        style={{
          fontSize: '13px',
          color: tokens.chipFg,
          lineHeight: 1.55,
          marginTop: title ? '6px' : 0,
        }}
      >
        {children}
      </div>
    </div>
  );
}
