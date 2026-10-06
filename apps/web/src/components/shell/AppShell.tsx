import type { ReactNode } from 'react';
import { chainsForEnv } from '@kade/shared';
import { Sidebar } from './Sidebar';
import { PreApprovedBanner } from './PreApprovedBanner';
import { SiteFooter } from './SiteFooter';
import { RESIDENT_NAV, type NavGroupConfig } from './nav';
import type { StepperItem } from '@/components/onboarding/PreRegistrationStepper';
import type { ShellReviewState } from './ReviewStatusChip';
import { readChainEnv } from '@/lib/env';
import type { SafeDeploymentStatus } from '@/lib/safe/manifest';

export interface AppShellProps {
  readonly children: ReactNode;
  /**
   * Retained for callers that still pass it (the shell never rendered anything
   * else with it). The resident's email is account configuration and is shown
   * on `/account`; the sidebar no longer displays it.
   */
  readonly email?: string | null;
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
  /**
   * Streamed slot: the sidebar Safe card. When present it replaces the
   * `SafeAddressCard` built from the value props, so a caller can resolve the
   * deployment record behind `<Suspense>` and keep the frame immediate.
   */
  readonly safeCard?: ReactNode;
  /**
   * Streamed slot: the sidebar review notice. When present it replaces the
   * `ReviewStatusChip` built from `reviewBar`.
   */
  readonly reviewNotice?: ReactNode;
  /**
   * Streamed slot: the top pre-approved banner. When present it replaces the
   * `PreApprovedBanner` built from `reviewBar`.
   */
  readonly reviewBanner?: ReactNode;
  /**
   * Streamed slot: the footer's Admin affordance. When present it replaces the
   * control built from `isReviewer`.
   */
  readonly footerAdmin?: ReactNode;
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
  safeCard,
  reviewNotice,
  reviewBanner,
  footerAdmin,
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
        isReviewer={isReviewer}
        review={review}
        safeCard={safeCard}
        reviewNotice={reviewNotice}
        footerAdmin={footerAdmin}
      />
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {reviewBanner ??
          (review.show ? (
            <PreApprovedBanner reference={review.reference} />
          ) : null)}
        {children}
        {/*
          The global footer lives here, in the one shell every authenticated
          route renders, rather than being passed per-route through
          `ContentContainer footer={...}`. It is a sibling of the page's padded
          content column, so its own spacing is the only gap below it.
        */}
        <SiteFooter />
      </main>
    </div>
  );
}
