'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { tokens } from '@/components/ui/tokens';

export interface UserMenuProps {
  /** Whether the user has a reviewers row, so the menu can offer /admin. */
  readonly isReviewer?: boolean;
}

/**
 * The signed-in resident's account button and its menu.
 *
 * The trigger is avatar-only: the resident's email is account configuration and
 * belongs on `/account`, not in the shell. Keeping the trigger (rather than the
 * identity row) preserves the route to sign-out, which lives behind the button
 * as one option among the resident's account-level actions — `Account
 * settings`, and `Admin` for a reviewer. The menu reuses the shell's visual
 * language (the same surface, border and radius as the footer cards) rather
 * than a new component library.
 *
 * It opens on click and closes on an outside click or Escape; Escape returns
 * focus to the button. The trigger is a real `<button>`, so it is keyboard
 * reachable, and it advertises the menu with `aria-haspopup`/`aria-expanded`.
 */
export function UserMenu({ isReviewer = false }: UserMenuProps) {
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

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        marginTop: '12px',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      {/*
        Avatar-only: the email is account configuration and lives on
        `/account`. The button still carries the menu, so sign-out and the
        route to the account settings stay reachable.
      */}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        title="Account"
        onClick={() => setOpen((value) => !value)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '4px',
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: '999px',
          fontFamily: 'inherit',
          cursor: 'pointer',
        }}
      >
        <span
          aria-hidden
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${tokens.brandPrimary}, #8FC2FF)`,
            flex: '0 0 auto',
          }}
        />
      </button>

      {open ? (
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
            onClick={() => setOpen(false)}
            style={menuItem}
          >
            Account settings
          </Link>
          {isReviewer ? (
            <Link
              href="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
              style={menuItem}
            >
              Admin
            </Link>
          ) : null}
          <form action="/auth/signout" method="post" style={{ margin: 0 }}>
            <button type="submit" role="menuitem" style={signOutItem}>
              Sign out
            </button>
          </form>
        </div>
      ) : null}
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
