'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { tokens } from './tokens';

/**
 * The repeated dialog surface (design handoff, "Modals"): a fixed full-screen
 * backdrop at `rgba(16,24,40,.45)` / `z-index: 60`, a centered card at
 * 400–460px with an 18px radius and a `fadeUp .16s ease-out` entrance.
 *
 * It is keyboard- and screen-reader-usable: the card is the dialog, focus moves
 * to it on open, Escape and a click outside the card close it, and clicks inside
 * the card stop propagating to the backdrop so they cannot dismiss it.
 */
export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The dialog's accessible name, rendered as its heading. */
  readonly title: string;
  readonly children: ReactNode;
  /** The card's maximum width; the handoff uses 400–460px. */
  readonly maxWidth?: number;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 440,
}: ModalProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  // Portals need a document. Client components are still server-rendered, so
  // wait until after mount before creating one.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  useEffect(() => {
    if (open) cardRef.current?.focus();
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div onClick={onClose} style={backdrop}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{ ...card, maxWidth }}
      >
        <div style={header}>
          <h2 id={titleId} style={heading}>
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={closeButton}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const backdrop: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(16,24,40,.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '32px',
  zIndex: 60,
};

const card: CSSProperties = {
  background: '#fff',
  borderRadius: '18px',
  width: '100%',
  maxHeight: '86vh',
  overflow: 'auto',
  boxShadow: '0 30px 80px -20px rgba(16,24,40,.45)',
  animation: 'fadeUp .16s ease-out',
  outline: 'none',
};

const header: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '10px',
  padding: '20px 24px 0',
};

const heading: CSSProperties = {
  margin: 0,
  fontSize: '18px',
  fontWeight: 700,
  letterSpacing: '-.01em',
  color: tokens.ink,
};

const closeButton: CSSProperties = {
  border: 0,
  background: 'transparent',
  color: tokens.muted,
  fontFamily: 'inherit',
  fontSize: '22px',
  lineHeight: 1,
  cursor: 'pointer',
  padding: '4px 6px',
  borderRadius: '8px',
};
