'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { tokens } from '@/components/ui/tokens';

export interface PositionMenuProps {
  /** The instrument the row belongs to, used to label the menu. */
  readonly instrumentName: string;
  /** The `data-testid` the row's position carries. */
  readonly testId: string;
  /**
   * The trigger's visible text: the real held amount (`$10,000 held`) or the
   * unread label (`Position unread`). It is the row's one piece of state **and**
   * the control, so there is nothing to weigh against an action.
   */
  readonly label: string;
  /** The trigger's tooltip: the real amount, or the specific read reason. */
  readonly title: string;
  /**
   * Whether the read established a real position. It changes only the first
   * menu item's wording: `Allocate more` when a position is known to exist,
   * `Allocate` when the read failed and no position can be claimed.
   */
  readonly hasPosition: boolean;
  /** A held position uses the neutral chip; an unread one uses the alert tone. */
  readonly variant: 'held' | 'unknown';
  readonly onAllocate: () => void;
  readonly onUnallocate: () => void;
}

/**
 * The Invest row's position control.
 *
 * **The amount is the control.** A row with no position renders a single
 * `Allocate` button (in `InvestScreen`). A row that holds a position renders one
 * thing: this trigger, reading the real held amount, which opens a menu holding
 * the two directions — `Allocate more` and `Un-allocate`. An unread position
 * keeps its honest `Position unread` trigger (with the read's real reason on
 * hover) and opens the same menu, so the withdraw path is never the state that
 * gets dropped when a read fails.
 *
 * It follows `UserMenu`'s interaction idiom — opens on click, closes on an
 * outside click or Escape with focus returned to the trigger, is keyboard
 * reachable, and advertises itself with `aria-haspopup`/`aria-expanded` and
 * `role="menu"` — and, unlike `UserMenu`, it fully implements the menu it
 * declares: focus moves into the menu, Arrow keys/Home/End rove between the
 * items, and Escape returns to the trigger.
 *
 * The menu is rendered in a portal: the row lives inside the instrument card's
 * `overflow: hidden` and its horizontal scroller, both of which would clip an
 * absolutely positioned dropdown. The portal escapes that clip while the
 * outside-click check still treats the menu as inside the control.
 *
 * The collapsed trigger matches the reference's button metrics (`height: 32px`,
 * `border-radius: 999px`, `font-size: 12px`, `font-weight: 600`) so it fits the
 * reference's `110px` action column. It carries a small chevron whose own
 * transition and the menu's enter animation live in {@link MENU_CSS}: inline
 * style objects cannot express `:hover`, `@keyframes` or a
 * `prefers-reduced-motion` media query. The animation is pure progressive
 * enhancement — the menu is fully usable (and every interaction unchanged) if
 * it never runs.
 */
export function PositionMenu({
  instrumentName,
  testId,
  label,
  title,
  hasPosition,
  variant,
  onAllocate,
  onUnallocate,
}: PositionMenuProps) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Close on an outside click or Escape. Escape returns focus to the trigger,
  // exactly as `UserMenu` does; the menu is portaled, so "outside" is checked
  // against the trigger's own container *and* the menu.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
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

  // Anchor the portaled menu to the trigger's right edge, and follow the page
  // while it is open so it never drifts away from its row.
  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPos({ top: rect.bottom + 6, left: rect.right });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // A declared `role="menu"` should put focus inside itself: the first item is
  // the initial focus, and the arrow keys move from there.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
  }, [open]);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = itemRefs.current.filter(
      (item): item is HTMLButtonElement => item !== null,
    );
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);
    let next = current;
    if (event.key === 'ArrowDown') {
      next = current < 0 ? 0 : (current + 1) % items.length;
    } else if (event.key === 'ArrowUp') {
      next = current <= 0 ? items.length - 1 : current - 1;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = items.length - 1;
    } else if (event.key === 'Tab') {
      // Tabbing out of the menu closes it, as the pattern expects; move focus
      // back before the menu unmounts so it is not lost.
      setOpen(false);
      triggerRef.current?.focus();
      return;
    } else {
      return;
    }
    event.preventDefault();
    items[next]?.focus();
  }

  const triggerStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    // The reference's button metrics for the collapsed control
    // (`reference/design-handoff/kade-mvp.dc.html`: height 32px, radius 999px,
    // font-size 12px, font-weight 600). It is deliberately not width-capped:
    // it lays out at its natural width inside the row's end-aligned action
    // cell, so its text is never clipped and any excess falls into the free
    // inter-column gutter instead of truncating the state it carries.
    flexShrink: 0,
    height: '32px',
    padding: '0 8px 0 10px',
    borderRadius: '999px',
    border:
      variant === 'unknown' ? `1px solid #FECDD3` : `1px solid ${tokens.border}`,
    background: variant === 'unknown' ? '#FEF3F2' : tokens.chipBg,
    color: variant === 'unknown' ? tokens.danger : tokens.ink,
    fontFamily: 'inherit',
    fontSize: '12px',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
  };

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-flex', minWidth: 0 }}
    >
      {/*
        The `:hover`/`:focus-visible` states, the keyframes and the
        `prefers-reduced-motion` suppression cannot live in an inline style
        object. `src/app/globals.css` — where this app keeps its other such
        rules — is outside this component's scope, so the small stylesheet is
        rendered with the control that uses it. Its content is static and
        identical, so a duplicate tag per rendered menu is harmless.
      */}
      <style>{MENU_CSS}</style>
      <button
        ref={triggerRef}
        type="button"
        className="kade-position-trigger"
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((value) => !value)}
        style={triggerStyle}
      >
        {label}
        <span
          aria-hidden
          className="kade-position-caret"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            color: variant === 'unknown' ? tokens.danger : tokens.muted,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 8 8"
            fill="none"
            focusable="false"
            aria-hidden
          >
            <path
              d="M1.5 3 4 5.5 6.5 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="kade-position-menu"
              aria-label={`${instrumentName} position actions`}
              onKeyDown={onMenuKeyDown}
              style={{
                position: 'fixed',
                top: menuPos?.top ?? 0,
                left: menuPos?.left ?? 0,
                transform: 'translateX(-100%)',
                minWidth: '160px',
                background: '#fff',
                border: `1px solid ${tokens.border}`,
                borderRadius: '12px',
                boxShadow: '0 8px 24px rgba(16, 24, 40, .12)',
                padding: '4px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                zIndex: 40,
              }}
            >
              <button
                ref={(node) => {
                  itemRefs.current[0] = node;
                }}
                type="button"
                role="menuitem"
                className="kade-position-menu-item"
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  onAllocate();
                }}
                style={menuItem}
              >
                {hasPosition ? 'Allocate more' : 'Allocate'}
              </button>
              <button
                ref={(node) => {
                  itemRefs.current[1] = node;
                }}
                type="button"
                role="menuitem"
                className="kade-position-menu-item"
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  onUnallocate();
                }}
                style={menuItem}
              >
                Un-allocate
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

const menuItem: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 10px',
  border: 0,
  borderRadius: '8px',
  // The base stays transparent even if the stylesheet never applies. The CSS
  // `:hover` rule sets `--kade-position-item-bg`, which this shorthand reads,
  // so the hover state lives in CSS without an `!important` fighting the
  // inline value.
  background: 'var(--kade-position-item-bg, transparent)',
  color: tokens.chipFg,
  fontFamily: 'inherit',
  fontSize: '12.5px',
  fontWeight: 600,
  textAlign: 'left',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

/**
 * The control's stylesheet.
 *
 * It is rendered as a scoped `<style>` alongside the control rather than added
 * to `src/app/globals.css` because `src/app/**` is outside this component's
 * scope, and the rules — `:hover`, `:focus-visible`, `@keyframes` and a
 * `prefers-reduced-motion` media query — cannot be expressed as inline styles.
 *
 * Progressive enhancement: the menu's enter animation and the caret's rotation
 * are additive. If the keyframes are unsupported or the stylesheet is dropped,
 * the menu renders in its final, fully usable position; the open/close, focus
 * and keyboard behaviour are JavaScript and unaffected. `prefers-reduced-motion`
 * removes the animation and the transitions entirely for a user who asks for
 * that, leaving an immediate, still-usable menu.
 */
const MENU_CSS = `
@keyframes kade-position-menu-in {
  from {
    opacity: 0;
    transform: translateX(-100%) translateY(-4px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: translateX(-100%) translateY(0) scale(1);
  }
}
.kade-position-menu {
  transform-origin: top right;
  animation: kade-position-menu-in 0.16s cubic-bezier(0.22, 1, 0.36, 1);
}
.kade-position-menu-item:hover {
  --kade-position-item-bg: var(--kade-chip-bg, #f2f4f7);
}
.kade-position-menu-item:focus-visible {
  outline: 2px solid var(--kade-action, #0a7cff);
  outline-offset: -2px;
}
.kade-position-caret {
  transition: transform 0.18s ease;
}
.kade-position-trigger {
  transition: box-shadow 0.14s ease;
}
.kade-position-trigger:hover {
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.12);
}
@media (prefers-reduced-motion: reduce) {
  .kade-position-menu {
    animation: none;
  }
  .kade-position-caret,
  .kade-position-trigger {
    transition: none;
  }
}
`;
