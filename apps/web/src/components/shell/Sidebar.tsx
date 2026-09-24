'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { tokens } from '@/components/ui/tokens';
import { Logo } from './Logo';
import { NavDrawerControls } from './NavDrawerControls';
import { NavItem } from './NavItem';
import { NetworkChip } from './NetworkChip';
import { SafeAddressCard } from './SafeAddressCard';
import { SidebarFooter } from './SidebarFooter';
import type { NavGroupConfig } from './nav';
import {
  PreRegistrationStepper,
  type StepperItem,
} from '@/components/onboarding/PreRegistrationStepper';
import type { SafeDeploymentStatus } from '@/lib/safe/manifest';

export interface SidebarProps {
  readonly nav: readonly NavGroupConfig[];
  readonly stepper?: readonly StepperItem[];
  readonly network: string;
  readonly safeAddress: string | null;
  /** True once the Safe contract exists on chain. */
  readonly safeDeployed?: boolean;
  /** The record's status, so a failure reads differently from "still pending". */
  readonly safeStatus?: SafeDeploymentStatus | null;
  readonly explorerUrl?: string | null;
  readonly email: string | null;
  /** Whether the user has a reviewers row, so the Admin switch links to /admin. */
  readonly isReviewer?: boolean;
}

/**
 * The reference sidebar: fixed 240px column, logo, network chip, grouped nav,
 * the Safe address card and the footer.
 */
export function Sidebar({
  nav,
  stepper,
  network,
  safeAddress,
  safeDeployed = false,
  safeStatus = null,
  explorerUrl = null,
  email,
  isReviewer = false,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      <NavDrawerControls />
      <aside className="kade-sidebar">
        <div style={{ padding: '0 6px 18px' }}>
          <Logo />
        </div>

        <div style={{ margin: '0 6px 18px' }}>
          <NetworkChip label={network} />
        </div>

        {stepper ? (
          <PreRegistrationStepper items={stepper} />
        ) : (
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {nav.map((group, groupIndex) => (
              <div key={group.label ?? `group-${groupIndex}`}>
                {group.label ? (
                  <div
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                      color: tokens.muted,
                      padding: '16px 12px 6px',
                    }}
                  >
                    {group.label}
                  </div>
                ) : null}
                {group.items.map((item) => (
                  <NavItem
                    key={item.href}
                    item={item}
                    active={pathname === item.href}
                  />
                ))}
              </div>
            ))}
          </nav>
        )}

        <div style={{ marginTop: '18px' }}>
          <SafeAddressCard
            address={safeAddress}
            network={network}
            deployed={safeDeployed}
            status={safeStatus}
            explorerUrl={explorerUrl}
          />
        </div>

        <SidebarFooter
          isReviewer={isReviewer}
          adminActive={pathname.startsWith('/admin')}
          email={email}
        />
      </aside>
    </>
  );
}
