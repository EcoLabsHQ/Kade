import type { ReactNode } from 'react';
import { chainsForEnv } from '@kade/shared';
import { Sidebar } from './Sidebar';
import { PreApprovedBanner } from './PreApprovedBanner';
import { RESIDENT_NAV, type NavGroupConfig } from './nav';
import type { StepperItem } from '@/components/onboarding/PreRegistrationStepper';
import { readChainEnv } from '@/lib/env';
import type { SafeDeploymentStatus } from '@/lib/safe/manifest';

export interface AppShellProps {
  readonly children: ReactNode;
  readonly email: string | null;
  readonly safeAddress?: string | null;
  readonly safeDeployed?: boolean;
  readonly safeStatus?: SafeDeploymentStatus | null;
  readonly explorerUrl?: string | null;
  readonly network?: string;
  readonly nav?: readonly NavGroupConfig[];
  /** When present, the sidebar shows the pre-registration stepper instead of nav. */
  readonly stepper?: readonly StepperItem[];
  /**
   * Whether to show the pre-approved banner. Resolved by the page from the
   * application's review state (`@/lib/review/review-bar`); the shell never
   * shows it unconditionally.
   */
  readonly showReviewBar?: boolean;
  /** The resident's own application reference for the banner, or null. */
  readonly reviewReference?: string | null;
}

/**
 * The label for the active settlement chain, resolved from KADE_CHAIN_ENV and
 * the shared chain registry rather than hard-coded, so switching to the mainnet
 * configuration is a config change with no code edit (ADR 0005).
 */
function activeSettlementChainLabel(): string {
  const chains = chainsForEnv(readChainEnv());
  const ethereum =
    chains.find((chain) => chain.key === 'ethereum') ?? chains[0];
  return ethereum?.name ?? 'Ethereum Sepolia';
}

/**
 * The authenticated application frame: 240px sidebar plus the content column.
 * Rendered as a Server Component so the shell never blocks on a chain read
 * (ADR 0002).
 */
export function AppShell({
  children,
  email,
  safeAddress = null,
  safeDeployed = false,
  safeStatus = null,
  explorerUrl = null,
  network = activeSettlementChainLabel(),
  nav = RESIDENT_NAV,
  stepper,
  showReviewBar = false,
  reviewReference = null,
}: AppShellProps) {
  return (
    <div
      className="kade-shell"
      style={{
        minHeight: '100vh',
        background: '#fff',
      }}
    >
      <Sidebar
        nav={nav}
        stepper={stepper}
        network={network}
        safeAddress={safeAddress}
        safeDeployed={safeDeployed}
        safeStatus={safeStatus}
        explorerUrl={explorerUrl}
        email={email}
      />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {showReviewBar ? <PreApprovedBanner reference={reviewReference} /> : null}
        {children}
      </main>
    </div>
  );
}
