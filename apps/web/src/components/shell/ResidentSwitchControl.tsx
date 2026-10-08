import Link from 'next/link';
import { tokens } from '@/components/ui/tokens';

export interface ResidentSwitchControlProps {
  /**
   * True when the current route is not under `/admin`, so the switch highlights
   * Resident. Passed in by the caller: this component renders on the server too,
   * so reading `window` here would mismatch on hydration and would never update
   * on a client-side navigation.
   */
  readonly residentActive?: boolean;
}

/**
 * The Resident half of the sidebar's Resident/Admin switch.
 *
 * Extracted from `SidebarFooter`, where it was a static `<span>`: it looked like
 * the live mode (a white "active" background) and did nothing, so from `/admin`
 * there was no way back to the resident view through the switch, and in every
 * mode the Resident half was unreachable by keyboard. It is now a real link to
 * `/`, the resident overview — a normal anchor, so it is focusable and operable
 * with the keyboard and carries the accessible name `Resident`.
 *
 * The highlight follows `residentActive`, which the caller derives from the
 * route. In admin mode it is inactive, so it cannot read as the current mode
 * while `AdminSwitchControl` is highlighted. It is a peer of that control: the
 * two halves share their sizing and active/inactive treatment.
 */
export function ResidentSwitchControl({
  residentActive = true,
}: ResidentSwitchControlProps) {
  return (
    <Link
      href='/'
      title='Open the resident view.'
      aria-current={residentActive ? 'page' : undefined}
      style={{
        flex: 1,
        padding: '8px 6px',
        borderRadius: '9px',
        fontSize: '12.5px',
        fontWeight: 600,
        textAlign: 'center',
        background: residentActive ? '#fff' : 'transparent',
        color: tokens.brandPrimary,
        textDecoration: 'none',
      }}
    >
      Resident
    </Link>
  );
}
