import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OverviewTracker } from '@/components/review/OverviewTracker';
import type { OverviewInput } from '@/lib/review/overview';

/**
 * The Overview tracker renders the demo facts the Overview page reads
 * server-side — the demo "Documents complete" flag and the Colosseum demo
 * state — through the same pure `buildOverview` the rest of the screen uses.
 * These tests pin that the server-provided state surfaces, and that nothing is
 * fabricated when the state is empty.
 *
 * The tracker no longer reads `localStorage`: the state is read on the server
 * for the account and passed in. The tests below prove the tracker ignores any
 * stale browser storage and renders only what the server provided.
 */

const PROFILE = 'user-1';

function input(overrides: Partial<OverviewInput> = {}): OverviewInput {
  return {
    gate: 'pending',
    tier: '3-year',
    preapprovalUsdc: 1.75,
    fee: { status: 'none' },
    reviewUid: null,
    serviceUid: null,
    safeAddress: '0x5Af1000000000000000000000000000000000c09D',
    safeDeployed: true,
    qualified: { status: 'known', usd: 0 },
    preapprovalPaid: false,
    kycUid: null,
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('OverviewTracker demo state from the server', () => {
  it('shows the documents row as not started when the server flag is absent', () => {
    render(<OverviewTracker input={input()} />);

    expect(screen.getByText('Documents complete')).toBeInTheDocument();
    expect(screen.getByText(/not marked complete/i)).toBeInTheDocument();
    expect(
      screen.queryByText('Colosseum Resident'),
    ).toBeNull();
    // Nothing demo is shown, so no chip.
    expect(screen.queryByTestId('overview-tracker-demo')).toBeNull();
  });

  it('reflects the server-side documents flag', () => {
    render(<OverviewTracker input={input({ documentsComplete: true })} />);

    expect(screen.getByText(/marked complete in the demo/i)).toBeInTheDocument();
    // The documents row is itself demo state, so the chip turns on.
    expect(screen.getByTestId('overview-tracker-demo')).toHaveTextContent(
      /Demo data/,
    );
  });

  it('reflects the server-side Colosseum state', () => {
    render(
      <OverviewTracker
        input={input({
          colosseum: {
            residentSince: '2026-01-01T00:00:00.000Z',
            citizenAt: '2026-01-01T00:02:00.000Z',
            passportSerial: 'KADE-CL-ABCD2345',
          },
        })}
      />,
    );

    expect(screen.getByText('Colosseum Resident')).toBeInTheDocument();
    expect(screen.getByText('Colosseum Citizen')).toBeInTheDocument();
    expect(screen.getByText(/KADE-CL-ABCD2345/)).toBeInTheDocument();
    // The demo rows turn the honesty chip on, so they cannot pose as records.
    expect(screen.getByTestId('overview-tracker-demo')).toHaveTextContent(
      /Demo data/,
    );
  });
});

/**
 * Regression: the tracker must read ONLY the server-provided state. It used to
 * read `localStorage` under `applications.id`, which is exactly the dependency
 * this change removes. These tests seed the old browser keys and prove they have
 * no effect, so a future re-introduction of a browser read fails here.
 */
describe('OverviewTracker ignores browser storage', () => {
  it('renders nothing demo from stale localStorage keys when the server state is empty', () => {
    // The old browser keys, written by the pre-server build.
    window.localStorage.setItem(
      `kade.colosseum.progress.v2.${PROFILE}`,
      JSON.stringify({
        residentSince: '2026-01-01T00:00:00.000Z',
        citizenAt: null,
        passportSerial: null,
      }),
    );
    window.localStorage.setItem(
      `kade.documents.complete.v2.${PROFILE}`,
      '1',
    );

    render(<OverviewTracker input={input()} />);

    // The stale browser state must not surface: the server state is authoritative.
    expect(screen.getByText(/not marked complete/i)).toBeInTheDocument();
    expect(screen.queryByText('Colosseum Resident')).toBeNull();
  });

  it('renders the server state even when no browser key exists', () => {
    render(<OverviewTracker input={input({ documentsComplete: true })} />);

    expect(screen.getByText(/marked complete in the demo/i)).toBeInTheDocument();
  });
});
