import Link from 'next/link';
import { tokens } from '@/components/ui/tokens';
import type { NavItemConfig } from './nav';

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
 */
export function NavItem({ item, active }: NavItemProps) {
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
      style={{
        ...shared,
        background: active ? tokens.activeNavBg : 'transparent',
        color: active ? tokens.brandPrimary : tokens.chipFg,
        textDecoration: 'none',
      }}
    >
      <span
        style={{
          width: '5px',
          height: '5px',
          borderRadius: '50%',
          background: 'currentColor',
          opacity: 0.55,
        }}
      />
      {item.label}
    </Link>
  );
}
