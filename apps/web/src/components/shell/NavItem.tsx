'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { tokens } from '@/components/ui/tokens';
import type { NavItemConfig } from './nav';
import {
  isColosseumAttention,
  subscribeColosseumAttention,
} from './colosseum-attention';

export interface NavItemProps {
  readonly item: NavItemConfig;
  readonly active: boolean;
}

/**
 * A dashboard nav row from the reference: dot + label, active background
 * `#EAF2FC`, active foreground `#0063B5`.
 *
 * `locked` items are rendered as disabled controls styled with the locked
 * colour `#98A2B3` and `cursor: not-allowed` (contract section 9).
 *
 * The Residency item alone can carry the Colosseum demo highlight: when the
 * Residency screen's mocked 2-minute window has elapsed and "Become a Citizen"
 * is available, this client component paints it with the action colour, a tint
 * and a gentle pulse so it reads as "there is something to do". The highlight
 * is demo state shared through `./colosseum-attention`, not a server gate; every
 * other item is unchanged.
 */
export function NavItem({ item, active }: NavItemProps) {
  const highlighted = useResidencyHighlight(item.href === '/residency');

  const shared = {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    textAlign: 'left' as const,
    padding: '9px 12px',
    border: 0,
    borderRadius: '10px',
    fontFamily: 'inherit',
    fontSize: '14px',
    fontWeight: 500,
  };

  if (item.locked) {
    return (
      <button
        type="button"
        disabled
        aria-disabled="true"
        title={item.lockReason}
        style={{
          ...shared,
          background: 'transparent',
          color: tokens.locked,
          cursor: 'not-allowed',
        }}
      >
        <span
          className="kade-nav-dot"
          style={{
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            background: 'currentColor',
            opacity: 0.55,
          }}
        />
        {item.label}
      </button>
    );
  }

  const activeBackground = active ? tokens.activeNavBg : 'transparent';
  const background = highlighted ? '#E6F1FE' : activeBackground;

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      data-colosseum-attention={highlighted ? 'true' : undefined}
      className={highlighted ? 'kade-nav-attention' : undefined}
      style={{
        ...shared,
        background,
        color:
          highlighted || active ? tokens.brandPrimary : tokens.chipFg,
        fontWeight: highlighted ? 600 : 500,
        textDecoration: 'none',
      }}
    >
      <span
        className="kade-nav-dot"
        style={{
          width: '5px',
          height: '5px',
          borderRadius: '50%',
          background: 'currentColor',
          opacity: highlighted ? 1 : 0.55,
        }}
      />
      {item.label}
    </Link>
  );
}

/**
 * The Colosseum highlight for the Residency item: read the shared client state
 * on mount and re-read whenever the Residency screen changes it. The hook is
 * always called (React's rules of hooks); `enabled` is false for every other
 * item, so only the Residency item can ever be highlighted.
 */
function useResidencyHighlight(enabled: boolean): boolean {
  const [highlighted, setHighlighted] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHighlighted(false);
      return;
    }
    setHighlighted(isColosseumAttention());
    return subscribeColosseumAttention(() => {
      setHighlighted(isColosseumAttention());
    });
  }, [enabled]);

  return highlighted;
}
