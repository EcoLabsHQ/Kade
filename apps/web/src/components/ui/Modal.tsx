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
 * It is keyboard- and screen-reader-usable: the card is the dialog, Escape and
 * a click outside the card close it, and clicks inside the card stop
 * propagating to the backdrop so they cannot dismiss it.
 *
 * Focus is managed deliberately:
 *
 *   - On open, focus moves to the **card itself** (`tabIndex={-1}`). That is
 *     the safe, non-destructive default for every caller: the card is announced
 *     with the dialog's accessible name, no control (least of all a confirm or
 *     a spend action) is triggered, and the first Tab proceeds into the
 *     dialog's own controls. None of the callers has a destructive default
 *     action; the card is the deliberate target regardless.
 *   - While open, Tab is contained: from the last focusable control it wraps to
 *     the first, and Shift+Tab from the first wraps to the last, for dialogs
 *     with one control or many. The list of focusable controls is recomputed on
 *     every Tab, so a dialog whose content changes while open (a button swapped
 *     for a spinner, a disclosure opened) cannot leave the trap holding a stale
 *     node.
 *   - On every close path — Escape, the backdrop, the close button, or a
 *     caller's own action — focus returns to the element that opened the
 *     dialog. If that element is gone (a confirm unmounts its trigger, or the
 *     view changes under the dialog), focus falls back to the first focusable
 *     control in the page's `main` landmark so the resident is not dropped on
 *     `<body>`; `<body>` is the documented last resort when there is no main
 *     landmark.
 *
 * The card's internal scroll (`maxHeight: 86vh; overflow: auto`) and the
 * `fadeUp` entrance are untouched.
 */
export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The dialog's accessible name, rendered as its heading. */
  readonly title: string;
  /**
   * An optional reference eyebrow rendered above the title (11px/700, uppercase,
   * muted). Supplying it switches the header to the reference's two-line chrome
   * — the eyebrow above a 15px title, with a bordered round close button and a
   * bottom divider. Omitting it keeps the original single-line header, so every
   * existing caller is unchanged.
   */
  readonly eyebrow?: string;
  readonly children: ReactNode;
  /** The card's maximum width; the handoff uses 400–460px. */
  readonly maxWidth?: number;
}

/**
 * Everything inside the dialog that can receive keyboard focus, in source
 * order. The list is recomputed on every Tab press rather than cached, so a
 * dialog whose content changes while it is open (a button swapped for a
 * spinner, a disclosure opened) cannot leave the trap holding a stale node.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isFocusable(element: HTMLElement): boolean {
  if (element.hasAttribute('disabled')) return false;
  // `aria-hidden` hides a subtree from assistive tech; its controls must not be
  // part of the trap either. `closest` covers the element itself and ancestors.
  if (element.closest('[aria-hidden="true"]') !== null) return false;
  // An element in a `hidden` subtree is not focusable. `closest` covers the
  // element itself and every ancestor, which is how `display: none` on an
  // ancestor is observed; jsdom has no layout, so this is what excludes the
  // collapsed disclosure content inside the Invest dialog.
  if (element.closest('[hidden]') !== null) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return true;
}

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(isFocusable);
}

/**
 * The dialogs currently open, oldest first. Only the topmost one traps Tab, so
 * a dialog rendered inside another (or a page that opens two by mistake) does
 * not fight over focus.
 */
const openDialogs: HTMLElement[] = [];

/**
 * Contain Tab/Shift+Tab inside `container`: forward from the last control goes
 * to the first, backward from the first goes to the last. When focus is not
 * inside at all — a control was removed while it held focus, so focus fell to
 * `<body>` — the next Tab re-enters the dialog at the appropriate end.
 */
function trapTab(event: KeyboardEvent, container: HTMLElement): void {
  const focusables = getFocusable(container);
  if (focusables.length === 0) {
    // Nothing is focusable: hold focus on the dialog itself rather than let it
    // escape to the controls behind.
    event.preventDefault();
    container.focus();
    return;
  }

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!first || !last) {
    // Defensive: `length > 0` guarantees both, but the compiler cannot see it.
    event.preventDefault();
    container.focus();
    return;
  }
  const active = document.activeElement;
  const inside = active instanceof HTMLElement && container.contains(active);

  if (event.shiftKey) {
    if (!inside || active === container || active === first) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  if (!inside || active === container || active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Return focus to the element that opened the dialog. The opener can be gone by
 * then — a confirm can unmount its trigger, or the view can change under the
 * dialog — so a removed opener falls back to the first focusable control in the
 * page's `main` landmark, which is the next place the resident's attention
 * belongs. `<body>` is the documented last resort, only when there is no main
 * landmark at all; focus is never silently dropped there.
 */
function restoreFocus(opener: HTMLElement | null): void {
  if (opener?.isConnected && !opener.hasAttribute('disabled')) {
    opener.focus();
    // A disabled or hidden opener silently refuses focus; fall through to the
    // documented target rather than leaving focus wherever it was.
    if (document.activeElement === opener) return;
  }

  const main = document.querySelector<HTMLElement>('main, [role="main"]');
  if (main) {
    const firstFocusable = getFocusable(main)[0];
    if (firstFocusable) {
      firstFocusable.focus();
      return;
    }
    // A main landmark with nothing focusable inside: make it a deliberate
    // focus target for the hand-off, then restore its own attributes.
    const hadTabIndex = main.hasAttribute('tabindex');
    if (!hadTabIndex) main.setAttribute('tabindex', '-1');
    main.focus();
    if (!hadTabIndex) main.removeAttribute('tabindex');
    return;
  }

  document.body.focus();
}

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  maxWidth = 440,
}: ModalProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  // Portals need a document. Client components are still server-rendered, so
  // wait until after mount before creating one.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Remember what opened the dialog and restore it when the dialog closes or
  // unmounts. This effect is declared before the one that moves focus into the
  // card, so it captures the trigger rather than the card. `<body>`/`<html>`
  // mean there was no real opener (a programmatic open, or a trigger that
  // unmounted in the same commit — e.g. `PositionMenu` closes its menu as it
  // opens this dialog), so the restore uses its documented fallback.
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    openerRef.current =
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== document.documentElement
        ? active
        : null;
    return () => restoreFocus(openerRef.current);
  }, [open]);

  // Move focus into the card and register it as the topmost open dialog. The
  // `mounted` dependency matters for a dialog that mounts already open (see
  // `MoveToVaultDialog`): the portal does not exist until after the first
  // commit, so the card is only focusable once `mounted` flips.
  useEffect(() => {
    if (!open || !mounted) return;
    const card = cardRef.current;
    if (!card) return;
    openDialogs.push(card);
    card.focus();
    return () => {
      const index = openDialogs.lastIndexOf(card);
      if (index >= 0) openDialogs.splice(index, 1);
    };
  }, [open, mounted]);

  // Escape dismisses; Tab is contained to the topmost open dialog.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const card = cardRef.current;
      if (!card) return;
      if (openDialogs[openDialogs.length - 1] !== card) return;
      trapTab(event, card);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

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
        {eyebrow ? (
          <div style={eyebrowHeader}>
            <div style={{ minWidth: 0 }}>
              <div style={eyebrowStyle}>{eyebrow}</div>
              <h2 id={titleId} style={eyebrowHeading}>
                {title}
              </h2>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              style={eyebrowCloseButton}
            >
              ×
            </button>
          </div>
        ) : (
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
        )}
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

/*
 * The reference's two-line dialog header (kade-mvp.dc.html, the Fund vault and
 * Cash out dialogs), used only when `eyebrow` is supplied: an 11px uppercase
 * eyebrow above a 15px title, a bordered round close button, and a bottom
 * divider. The single-line header above stays the default for every caller that
 * does not opt in.
 */
const eyebrowHeader: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '18px 22px',
  borderBottom: `1px solid ${tokens.border}`,
};

const eyebrowStyle: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: tokens.muted,
};

const eyebrowHeading: CSSProperties = {
  margin: 0,
  marginTop: '4px',
  fontSize: '15px',
  fontWeight: 700,
  color: tokens.ink,
};

const eyebrowCloseButton: CSSProperties = {
  width: '28px',
  height: '28px',
  border: `1px solid ${tokens.border}`,
  background: '#fff',
  borderRadius: '50%',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: '14px',
  color: tokens.muted,
  lineHeight: 1,
  flex: '0 0 auto',
};
