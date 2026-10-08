'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
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
 * The Residency item alone can carry the Colosseum claim notice: once the
 * compliance window has elapsed and citizenship is claimable, its dot turns red
 * (and breathes gently) instead of the item taking the brand highlight. It stays
 * otherwise a normal row — no blue background, no brand text — so the red dot
 * is unambiguously the "something is waiting for you" signal. The state is
 * derived from `./colosseum-attention`, a transient browser-local hint the
 * Residency screen writes (see that module for exactly what it does and does not
 * promise); every other item is unchanged.
 */
export function NavItem({ item, active }: NavItemProps) {
  const claimable = useResidencyClaimable(item.href === '/residency');

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

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      data-colosseum-attention={claimable ? 'true' : undefined}
      className={claimable ? 'kade-nav-attention' : undefined}
      style={{
        ...shared,
        background: active ? tokens.activeNavBg : 'transparent',
        color: active ? tokens.brandPrimary : tokens.chipFg,
        textDecoration: 'none',
      }}
    >
      <span
        className="kade-nav-dot"
        data-colosseum-claimable-dot={claimable ? 'true' : undefined}
        style={{
          width: claimable ? '8px' : '5px',
          height: claimable ? '8px' : '5px',
          borderRadius: '50%',
          background: claimable ? tokens.danger : 'currentColor',
          opacity: claimable ? 1 : 0.55,
          flex: '0 0 auto',
          ...(claimable ? { boxShadow: claimableDotRing } : null),
        }}
      />
      {item.label}
      {/* The red dot is a colour-only cue; this keeps the notification in the
          accessible name so assistive tech is told, not just shown. */}
      {claimable ? (
        <span style={srOnly}>— citizenship can now be claimed</span>
      ) : null}
    </Link>
  );
}

/**
 * The Colosseum claim notice for the Residency item: read the shared client
 * state on mount and re-read whenever the Residency screen (or a sibling tab)
 * changes it. The hook is always called (React's rules of hooks); `enabled` is
 * false for every other item, so only the Residency item can ever be notified.
 */
function useResidencyClaimable(enabled: boolean): boolean {
  const [claimable, setClaimable] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setClaimable(false);
      return;
    }
    setClaimable(isColosseumAttention());
    return subscribeColosseumAttention(() => {
      setClaimable(isColosseumAttention());
    });
  }, [enabled]);

  return claimable;
}

/** A static ring so the small dot reads on every nav background, motion or not. */
const claimableDotRing = '0 0 0 3px rgba(180, 35, 24, 0.16)';

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
};
