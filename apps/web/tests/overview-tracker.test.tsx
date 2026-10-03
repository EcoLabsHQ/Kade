import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OverviewTracker } from '@/components/review/OverviewTracker';
import { documentsFlagKey } from '@/components/residency/colosseum-progress';
import type { OverviewInput } from '@/lib/review/overview';

/**
 * The Overview tracker reads the two facts that live only in the browser — the
 * demo "Documents complete" flag and the Colosseum demo progress — and reflects
 * them through the same pure `buildOverview` the rest of the screen uses. These
 * tests pin that the persisted state surfaces, and that nothing is fabricated
 * when the store is empty.
 */

const PROFILE = 'user-1';

function input(): OverviewInput {
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
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('OverviewTracker persisted demo state', () => {
  it('shows the documents row as not started when the flag is absent', () => {
    render(<OverviewTracker input={input()} profileKey={PROFILE} />);

    expect(screen.getByText('Documents complete')).toBeInTheDocument();
    expect(screen.getByText(/not marked complete/i)).toBeInTheDocument();
    expect(
      screen.queryByText('Colosseum Resident'),
    ).toBeNull();
    // Nothing demo is shown, so no chip.
    expect(screen.queryByTestId('overview-tracker-demo')).toBeNull();
  });

  it('reflects the persisted documents flag from the Residency step store', () => {
    window.localStorage.setItem(documentsFlagKey(PROFILE), '1');

    render(<OverviewTracker input={input()} profileKey={PROFILE} />);

    expect(screen.getByText(/marked complete in the demo/i)).toBeInTheDocument();
    // The documents row is itself demo state, so the chip turns on.
    expect(screen.getByTestId('overview-tracker-demo')).toHaveTextContent(
      /Demo data/,
    );
  });

  it('reflects the persisted Colosseum progress', () => {
    window.localStorage.setItem(
      'kade.colosseum.progress.user-1',
      JSON.stringify({
        residentSince: '2026-01-01T00:00:00.000Z',
        citizenAt: '2026-01-01T00:02:00.000Z',
        passportSerial: 'KADE-CL-ABCD2345',
      }),
    );

    render(<OverviewTracker input={input()} profileKey={PROFILE} />);

    expect(screen.getByText('Colosseum Resident')).toBeInTheDocument();
    expect(screen.getByText('Colosseum Citizen')).toBeInTheDocument();
    expect(screen.getByText(/KADE-CL-ABCD2345/)).toBeInTheDocument();
    // The demo rows turn the honesty chip on, so they cannot pose as records.
    expect(screen.getByTestId('overview-tracker-demo')).toHaveTextContent(
      /Demo data/,
    );
  });
});
