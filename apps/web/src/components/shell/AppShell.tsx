import type { ReactNode } from 'react';
import { chainsForEnv } from '@kade/shared';
import { Sidebar } from './Sidebar';
import { PreApprovedBanner } from './PreApprovedBanner';
import { RESIDENT_NAV, type NavGroupConfig } from './nav';
import type { StepperItem } from '@/components/onboarding/PreRegistrationStepper';
import type { ShellReviewState } from './ReviewStatusChip';
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
   * The resident's review state, resolved once by the page from
   * `@/lib/review/review-bar`. The top banner and the sidebar notice both read
   * this one value, so they cannot disagree. Supplying it takes precedence over
   * the individual props below.
   */
  readonly reviewBar?: ShellReviewState | null;
  /**
   * Whether to show the pre-approved banner. Resolved by the page from the
   * application's review state (`@/lib/review/review-bar`); the shell never
   * shows it unconditionally.
   *
   * Kept for callers that predate `reviewBar`; ignored when `reviewBar` is
   * supplied.
   */
  readonly showReviewBar?: boolean;
  /** The resident's own application reference for the banner, or null. */
  readonly reviewReference?: string | null;
  /** Whether the user has a reviewers row, so the shell can offer /admin. */
  readonly isReviewer?: boolean;
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
  reviewBar = null,
  showReviewBar = false,
  reviewReference = null,
  isReviewer = false,
}: AppShellProps) {
  // One resolved review value for the whole shell. The banner and the sidebar
  // notice are two renderings of this single object, never two computations.
  const review: ShellReviewState = reviewBar ?? {
    show: showReviewBar,
    reference: reviewReference,
    reviewed: false,
  };

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
        isReviewer={isReviewer}
        review={review}
      />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {review.show ? <PreApprovedBanner reference={review.reference} /> : null}
        {children}
      </main>
    </div>
  );
}
