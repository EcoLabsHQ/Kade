import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { tokens } from '@/components/ui/tokens';

export interface SidebarFooterProps {
  readonly email: string | null;
  readonly isReviewer?: boolean;
  /**
   * True when the current route is under `/admin`, so the switch highlights it.
   * Passed in by the caller: this component renders on the server too, so
   * reading `window` here would mismatch on hydration and would never update
   * on a client-side navigation.
   */
  readonly adminActive?: boolean;
}

/** Sidebar footer: signed-in identity, sign-out, and the Kade attribution. */
export function SidebarFooter({
  email,
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
      {email ? (
        <div
          style={{
            fontSize: '11px',
            color: tokens.muted,
            padding: '0 6px 10px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={email}
        >
          {email}
        </div>
      ) : null}
      <Card padding='4px' radius={12}>
        <form action='/auth/signout' method='post' style={{ margin: 0 }}>
          <button
            type='submit'
            style={{
              width: '100%',
              padding: '8px 6px',
              border: 0,
              borderRadius: '9px',
              background: 'transparent',
              fontFamily: 'inherit',
              fontSize: '12.5px',
              fontWeight: 600,
              color: tokens.chipFg,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </form>
      </Card>
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
