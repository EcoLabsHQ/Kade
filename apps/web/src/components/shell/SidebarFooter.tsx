import Link from 'next/link';
import { tokens } from '@/components/ui/tokens';

export interface SidebarFooterProps {
  readonly isReviewer?: boolean;
  /**
   * True when the current route is under `/admin`, so the switch highlights it.
   * Passed in by the caller: this component renders on the server too, so
   * reading `window` here would mismatch on hydration and would never update
   * on a client-side navigation.
   */
  readonly adminActive?: boolean;
}

/**
 * Sidebar footer: the Resident/Admin switch and the Kade attribution.
 *
 * The signed-in email is deliberately absent: it is account configuration and
 * lives on `/account`. The account menu — and sign-out behind it — now belongs
 * to the Safe card (the resident's account), not to a second, avatar-only
 * trigger down here, so the footer renders no account control of its own.
 *
 * The review-state notice is **not** rendered here: the MVP reference puts it
 * above the Safe card, so `Sidebar` renders it there from the one review value
 * it already shares with the top banner.
 */
export function SidebarFooter({
  isReviewer = false,
  adminActive = false,
}: SidebarFooterProps) {
  return (
    <>
      <div
        style={{
          background: tokens.surface,
          border: `1px solid ${tokens.border}`,
          borderRadius: '12px',
          padding: '4px',
          display: 'flex',
          gap: '4px',
          marginTop: '12px',
        }}
      >
        <span
          style={{
            flex: 1,
            padding: '8px 6px',
            borderRadius: '9px',
            fontSize: '12.5px',
            fontWeight: 600,
            textAlign: 'center',
            background: '#fff',
            color: tokens.brandPrimary,
          }}
        >
          Resident
        </span>
        {isReviewer ? (
          <Link
            href='/admin'
            title='Open the review queue.'
            style={{
              flex: 1,
              padding: '8px 6px',
              borderRadius: '9px',
              fontSize: '12.5px',
              fontWeight: 600,
              textAlign: 'center',
              background: adminActive ? tokens.activeNavBg : 'transparent',
              color: tokens.brandPrimary,
              textDecoration: 'none',
            }}
          >
            Admin
          </Link>
        ) : (
          <span
            aria-disabled='true'
            title='Admin access requires a reviewers row.'
            style={{
              flex: 1,
              padding: '8px 6px',
              borderRadius: '9px',
              fontSize: '12.5px',
              fontWeight: 600,
              textAlign: 'center',
              color: tokens.locked,
              cursor: 'not-allowed',
            }}
          >
            Admin
          </span>
        )}
      </div>
      <div
        style={{
          fontSize: '11px',
          color: tokens.muted,
          padding: '14px 6px 0',
          lineHeight: 1.6,
        }}
      >
        Onchain Island Resident Platform
        <br />
        powered by{' '}
        <a
          href='https://www.kade.global'
          target='_blank'
          rel='noreferrer'
          style={{ fontWeight: 500 }}
        >
          Kade
        </a>
      </div>
    </>
  );
}
