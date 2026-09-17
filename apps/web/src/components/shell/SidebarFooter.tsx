import { Card } from '@/components/ui/Card';
import { tokens } from '@/components/ui/tokens';

export interface SidebarFooterProps {
  readonly email: string | null;
}

/** Sidebar footer: signed-in identity, sign-out, and the Kade attribution. */
export function SidebarFooter({ email }: SidebarFooterProps) {
  return (
    <>
      <div style={{ flex: 1 }} />
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
      <Card padding="4px" radius={12}>
        <form action="/auth/signout" method="post" style={{ margin: 0 }}>
          <button
            type="submit"
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
          href="https://www.kade.global"
          target="_blank"
          rel="noreferrer"
          style={{ fontWeight: 500 }}
        >
          Kade
        </a>
      </div>
    </>
  );
}
