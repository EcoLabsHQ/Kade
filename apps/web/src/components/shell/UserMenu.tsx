'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react';
import Link from 'next/link';
import { tokens } from '@/components/ui/tokens';

export interface AccountMenuController {
  /** Whether the menu is open. */
  readonly open: boolean;
  /**
   * The element the menu is anchored to and that counts as "inside" for the
   * outside-click check. The trigger must be a descendant.
   */
  readonly containerRef: RefObject<HTMLDivElement | null>;
  /** The control focus returns to when the menu closes on Escape. */
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly toggle: () => void;
  readonly close: () => void;
}

/**
 * The account menu's interaction idiom, shared by every trigger.
 *
 * It opens on click, closes on an outside click or Escape, and returns focus to
 * the trigger on Escape. The trigger is a real `<button>` owned by the caller,
 * which advertises the menu with `aria-haspopup`/`aria-expanded`; the caller
 * renders it through `useAccountMenu`'s `triggerRef`/`toggle`.
 *
 * This is the same behaviour the avatar-only `UserMenu` had before the Safe card
 * took over the trigger; the menu markup lives in `UserMenu` below.
 */
export function useAccountMenu(): AccountMenuController {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return {
    open,
    containerRef,
    triggerRef,
    toggle: () => setOpen((value) => !value),
    close: () => setOpen(false),
  };
}

export interface UserMenuProps {
  /** Whether the user has a reviewers row, so the menu can offer /admin. */
  readonly isReviewer?: boolean;
  /** Called when the menu should close, e.g. after an item is chosen. */
  readonly onClose: () => void;
}

/**
 * The signed-in resident's account menu.
 *
 * It renders only the menu: the trigger is the surface the menu belongs to —
 * now the Safe card, whose address and network are the resident's account — and
 * is supplied by the caller via `useAccountMenu`. Keeping the menu here (rather
 * than at the footnote of the sidebar) means the resident's account-level
 * actions live on the resident's account card.
 *
 * `Account settings` and the reviewer-only `Admin` are links; `Sign out` is a
 * POST to `/auth/signout`, so the exit is a real form submission rather than a
 * client-side route change.
 *
 * It reuses the shell's visual language (the same surface, border and radius as
 * the footer cards) rather than a new component library.
 */
export function UserMenu({ isReviewer = false, onClose }: UserMenuProps) {
  return (
    <div
      role="menu"
      aria-label="Account"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 'calc(100% + 8px)',
        background: '#fff',
        border: `1px solid ${tokens.border}`,
        borderRadius: '12px',
        boxShadow: '0 8px 24px rgba(16, 24, 40, .12)',
        padding: '4px',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        zIndex: 20,
      }}
    >
      <Link
        href="/account"
        role="menuitem"
        onClick={onClose}
        style={menuItem}
      >
        Account settings
      </Link>
      {isReviewer ? (
        <Link href="/admin" role="menuitem" onClick={onClose} style={menuItem}>
          Admin
        </Link>
      ) : null}
      <form action="/auth/signout" method="post" style={{ margin: 0 }}>
        <button type="submit" role="menuitem" style={signOutItem}>
          Sign out
        </button>
      </form>
    </div>
  );
}

const menuItem: CSSProperties = {
  display: 'block',
  padding: '8px 10px',
  borderRadius: '8px',
  fontSize: '12.5px',
  fontWeight: 600,
  color: tokens.chipFg,
  textDecoration: 'none',
};

const signOutItem: CSSProperties = {
  ...menuItem,
  width: '100%',
  border: 0,
  background: 'transparent',
  fontFamily: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
};
