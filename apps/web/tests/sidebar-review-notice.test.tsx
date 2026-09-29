import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * The sidebar's review-status notice, matching the MVP reference.
 *
 * The notice and the top banner must be two renderings of one review state.
 * These tests inject that state once, through `AppShell`'s `reviewBar` prop, and
 * assert both follow it — so a second, independently computed notion of review
 * state would fail here. They are offline: the shell's Safe read and the
 * server actions it reaches are mocked, and no network is touched.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: vi.fn() }),
}));

// SafeRetryButton imports the server action lazily; mocking it keeps the
// browser bundle's server-only dependencies out of jsdom.
vi.mock('@/app/onboarding/deploy-actions', () => ({ deployAccount: vi.fn() }));

import { AppShell } from '@/components/shell/AppShell';
import type { ShellReviewState } from '@/components/shell/ReviewStatusChip';

const IN_REVIEW: ShellReviewState = {
  show: true,
  reference: 'CW-2026-0409',
  reviewed: false,
};
const CLEARED: ShellReviewState = {
  show: false,
  reference: 'CW-2026-0409',
  reviewed: true,
};
const NO_APPLICATION: ShellReviewState = {
  show: false,
  reference: null,
  reviewed: false,
};

function renderShell(reviewBar: ShellReviewState) {
  return render(
    <AppShell
      email="resident@example.com"
      network="Ethereum Sepolia"
      reviewBar={reviewBar}
    >
      <div>content</div>
    </AppShell>,
  );
}

const BANNER = /Use the platform now/;

describe('sidebar review notice', () => {
  it('renders the notice in the sidebar when pre-approved and in review', () => {
    renderShell(IN_REVIEW);

    const sidebar = screen.getByRole('complementary');
    const notice = screen.getByTestId('sidebar-review-notice');

    // It is the sidebar's notice, not a second banner in the content column.
    expect(sidebar.contains(notice)).toBe(true);
    expect(notice).toHaveTextContent('Pre-approved · in review');
    // And the top banner is up at the same time.
    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it('shows the cleared wording once the review has passed', () => {
    renderShell(CLEARED);

    const notice = screen.getByTestId('sidebar-review-notice');
    expect(notice).toHaveTextContent('Intake review cleared');
    expect(notice).not.toHaveTextContent('Pre-approved · in review');
    // The banner is gone because the review cleared, not because it lacked data.
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('shows no notice at all when there is no application', () => {
    renderShell(NO_APPLICATION);

    expect(screen.queryByTestId('sidebar-review-notice')).toBeNull();
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('drives the sidebar notice and the banner from one value', () => {
    const { rerender } = render(
      <AppShell
        email="resident@example.com"
        network="Ethereum Sepolia"
        reviewBar={IN_REVIEW}
      >
        <div>content</div>
      </AppShell>,
    );

    expect(screen.getByTestId('sidebar-review-notice')).toHaveTextContent(
      'Pre-approved · in review',
    );
    expect(screen.getByText(BANNER)).toBeInTheDocument();

    // Flip the single injected value: both renderings move together.
    rerender(
      <AppShell
        email="resident@example.com"
        network="Ethereum Sepolia"
        reviewBar={CLEARED}
      >
        <div>content</div>
      </AppShell>,
    );

    expect(screen.getByTestId('sidebar-review-notice')).toHaveTextContent(
      'Intake review cleared',
    );
    expect(screen.queryByText(BANNER)).toBeNull();
  });

  it('cannot be made to disagree by a contradictory single value', () => {
    // `show` decides the banner; the notice mirrors `show` first, so even an
    // impossible (show && reviewed) input keeps both in the same state.
    renderShell({ show: true, reference: null, reviewed: true });

    expect(screen.getByText(BANNER)).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-review-notice')).toHaveTextContent(
      'Pre-approved · in review',
    );
    expect(screen.queryByText('Intake review cleared')).toBeNull();
  });
});
