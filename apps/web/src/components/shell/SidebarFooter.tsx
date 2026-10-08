import type { ReactNode } from 'react';
import { tokens } from '@/components/ui/tokens';
import { AdminSwitchControl } from './AdminSwitchControl';
import { ResidentSwitchControl } from './ResidentSwitchControl';

export interface SidebarFooterProps {
  readonly isReviewer?: boolean;
  /**
   * True when the current route is under `/admin`, so the switch highlights it.
   * Passed in by the caller: this component renders on the server too, so
   * reading `window` here would mismatch on hydration and would never update
   * on a client-side navigation.
   */
  readonly adminActive?: boolean;
  /**
   * A streamed Admin affordance. When present it replaces the control built
   * from `isReviewer`, so the shell can resolve the reviewers row behind
   * `<Suspense>` without blocking the frame.
   */
  readonly admin?: ReactNode;
}

/**
 * Sidebar footer: the Resident/Admin switch and the Kade attribution.
 *
 * The signed-in email is deliberately absent: it is account configuration and
 * lives on `/account`. The account menu — and sign-out behind it — now belongs
 * to the Safe card (the resident's account), not to a second, avatar-only
 * trigger down here, so the footer renders no account control of its own.
 *
 * Both halves of the Resident/Admin switch are now real links: the Resident half
 * (`ResidentSwitchControl`) goes to `/`, so `/admin` has a way back to the
 * resident view, and the Admin half (`AdminSwitchControl`) goes to `/admin`.
 * `adminActive` decides which half is highlighted, so the switch cannot show the
 * wrong mode as live.
 *
 * The review-state notice is **not** rendered here: the MVP reference puts it
 * above the Safe card, so `Sidebar` renders it there from the one review value
 * it already shares with the top banner.
 */
export function SidebarFooter({
  isReviewer = false,
  adminActive = false,
  admin,
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
        <ResidentSwitchControl residentActive={!adminActive} />
        {admin ?? (
          <AdminSwitchControl
            isReviewer={isReviewer}
            adminActive={adminActive}
          />
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
