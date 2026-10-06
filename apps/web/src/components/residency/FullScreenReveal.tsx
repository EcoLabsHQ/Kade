'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tokens } from '@/components/ui/tokens';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * The shared full-screen shell for the Colosseum demo artifacts (the virtual
 * residency pass and the citizenship passport).
 *
 * It is deliberately a *celebration*, not a gate: everything it shows is
 * declared demo state, and it never writes anywhere real. The shell owns the
 * dialog contract so both artifacts inherit it:
 *
 *   - `role="dialog"` + `aria-modal="true"`, named by a heading;
 *   - focus moves into the card on open and returns to the opener on close;
 *   - Escape and a click outside dismiss it; a visible close control too;
 *   - the page behind is scroll-locked only while open, and restored on close,
 *     so dismissing never leaves the page blocked;
 *   - a polite live region announces the reveal;
 *   - under `prefers-reduced-motion: reduce` the reveal class is not applied at
 *     all (the CSS also disables the keyframes), so the artifact is simply
 *     readable.
 *
 * The reveal is intentionally non-blocking in spirit: there is no focus trap
 * and nothing to complete. The user can always get out.
 */
export interface FullScreenRevealProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The dialog's accessible name, rendered as a visually hidden heading. */
  readonly title: string;
  /** A polite announcement made to assistive tech when the reveal opens. */
  readonly announcement: string;
  /** The card's rise/scale keyframe class. */
  readonly revealClassName?: string;
  /** The card's 3D tilt/flip keyframe class. */
  readonly flipClassName?: string;
  readonly children: ReactNode;
}

export function FullScreenReveal({
  open,
  onClose,
  title,
  announcement,
  revealClassName,
  flipClassName,
  children,
}: FullScreenRevealProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  // Portals need a document. Client components are still server-rendered, so
  // wait until after mount before creating one.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Remember what had focus, and return focus there on close. The opener can be
  // gone by then (e.g. the "Become a Citizen" button unmounts into State E), so
  // only restore when it is still in the document.
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  // Move focus into the card once it is on screen.
  useEffect(() => {
    if (open) cardRef.current?.focus();
  }, [open]);

  // Escape dismisses.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Scroll-lock the page only while open; always restore the previous value.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={reducedMotion ? undefined : 'kade-reveal-backdrop'}
      onClick={onClose}
      style={backdrop}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={reducedMotion ? undefined : revealClassName ?? 'kade-reveal-card'}
        style={card}
      >
        <h2 id={titleId} style={srOnly}>
          {title}
        </h2>
        <p role="status" aria-live="polite" style={srOnly}>
          {announcement}
        </p>

        <div style={closeRow}>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={closeButton}
          >
            <span aria-hidden="true">×</span>
            <span style={closeLabel}>Close</span>
          </button>
        </div>

        <div style={scene}>
          <div
            className={reducedMotion ? undefined : flipClassName}
            style={tilt}
          >
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background:
    'radial-gradient(120% 120% at 50% 0%, rgba(7,29,48,.82) 0%, rgba(4,14,24,.92) 100%)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'clamp(12px, 4vw, 40px)',
  zIndex: 80,
};

const card: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  width: 'min(720px, 94vw)',
  maxHeight: '92vh',
  outline: 'none',
};

const closeRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  padding: '0 2px 10px',
};

const closeButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  height: '34px',
  padding: '0 14px',
  border: '1px solid rgba(255,255,255,.35)',
  borderRadius: '999px',
  background: 'rgba(255,255,255,.08)',
  color: '#f4f8ff',
  fontFamily: 'inherit',
  fontSize: '13px',
  fontWeight: 600,
  cursor: 'pointer',
};

const closeLabel: CSSProperties = {
  lineHeight: 1,
};

const scene: CSSProperties = {
  perspective: '1200px',
  overflow: 'auto',
  display: 'flex',
  justifyContent: 'center',
  // Let the scroll area shrink inside the flex column instead of overflowing
  // the card's `maxHeight`.
  minHeight: 0,
};

const tilt: CSSProperties = {
  transformStyle: 'preserve-3d',
  width: '100%',
};

const srOnly: CSSProperties = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
  color: tokens.ink,
};
