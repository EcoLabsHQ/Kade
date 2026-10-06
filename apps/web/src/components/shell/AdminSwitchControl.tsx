import Link from 'next/link';
import { tokens } from '@/components/ui/tokens';

export interface AdminSwitchControlProps {
  /** Whether the user has a reviewers row, so the switch offers `/admin`. */
  readonly isReviewer?: boolean;
  /** True when the current route is under `/admin`, so the switch highlights it. */
  readonly adminActive?: boolean;
}

/**
 * The Admin half of the sidebar's Resident/Admin switch.
 *
 * Extracted from `SidebarFooter` so the streaming shell can render the same
 * control from a `<Suspense>` boundary (`ShellAdminSwitch`) without duplicating
 * its markup. A reviewer gets a link to `/admin`; everyone else gets the
 * disabled, non-interactive placeholder.
 *
 * `isReviewer` is display-only: RLS is the real gate on the Admin surface.
 */
export function AdminSwitchControl({
  isReviewer = false,
  adminActive = false,
}: AdminSwitchControlProps) {
  if (isReviewer) {
    return (
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
    );
  }

  return (
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
  );
}
