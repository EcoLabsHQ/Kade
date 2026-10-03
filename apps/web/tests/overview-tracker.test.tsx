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

/**
 * Regression (review finding F1): the Overview and the Residency step must key
 * the persisted demo state on the SAME identity — `applications.id`, which is
 * what `ResidencyStep` writes and what the Overview page now passes as
 * `profileKey`. This test writes under the application id (the real writer key)
 * and reads it back, pinning that the two surfaces agree.
 */
describe('OverviewTracker key agreement with the Residency step', () => {
  const APPLICATION_ID = 'app-9f3c2b1a-0000-4000-8000-000000000001';

  it('reads documents + Colosseum state persisted under the application id', () => {
    window.localStorage.setItem(documentsFlagKey(APPLICATION_ID), '1');
    window.localStorage.setItem(
      `kade.colosseum.progress.${APPLICATION_ID}`,
      JSON.stringify({
        residentSince: '2026-01-01T00:00:00.000Z',
        citizenAt: null,
        passportSerial: null,
      }),
    );

    render(<OverviewTracker input={input()} profileKey={APPLICATION_ID} />);

    expect(screen.getByText(/marked complete in the demo/i)).toBeInTheDocument();
    expect(screen.getByText('Colosseum Resident')).toBeInTheDocument();
  });

  it('does not read state written under a different identity', () => {
    // Written under the auth user id (the wrong key), read under the application
    // id: the tracker must show nothing, so a future key drift is caught.
    window.localStorage.setItem(documentsFlagKey('a-different-user-id'), '1');

    render(<OverviewTracker input={input()} profileKey={APPLICATION_ID} />);

    expect(screen.getByText(/not marked complete/i)).toBeInTheDocument();
  });
});
