import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { deriveResidencyView, type ResidencyFacts } from '@/lib/residency/checks';
import type { ResidencySnapshot } from '@/lib/residency/server';
import type { ColosseumMembership } from '@/lib/colosseum/server';

/**
 * The Colosseum residency surface states (COLOSSEUM-1).
 *
 * The screen is driven by the real snapshot the server assembles, so these
 * tests build snapshots through the real `deriveResidencyView` and assert the
 * four states the contract names: the registration call-to-action, the 10 USDC
 * threshold, the "complete your residency steps" pop-up, and the congrats state
 * with the exact 2-minute sentence. The server actions are mocked, so the
 * component's own state selection is what is under test.
 */

const hoisted = vi.hoisted(() => ({
  refresh: vi.fn(),
  register: vi.fn(),
  sync: vi.fn(),
  become: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: hoisted.refresh, push: vi.fn() }),
}));
vi.mock('@/app/colosseum/actions', () => ({
  registerColosseumResidencyAction: hoisted.register,
  syncColosseumResidencyAction: hoisted.sync,
  becomeColosseumCitizenAction: hoisted.become,
}));

import { ColosseumScreen } from '@/components/colosseum/ColosseumScreen';

function facts(overrides: Partial<ResidencyFacts> = {}): ResidencyFacts {
  return {
    tier: 'colosseum',
    identity: {
      provider: 'self',
      status: 'valid',
      verifiedAt: '2026-09-20T00:00:00Z',
      selfNullifier: 'n',
    },
    qualified: { status: 'known', usd: 10 },
    review: 'cleared',
    serviceFee: { recorded: true, verified: true, amountUsdc: 10 },
    permit: { issued: false, uid: null },
    ...overrides,
  };
}

function snapshot(
  f: ResidencyFacts,
  overrides: Partial<ResidencySnapshot> = {},
): ResidencySnapshot {
  return {
    applicationId: 'app-1',
    applicationRef: 'CW-2026-0409',
    tier: f.tier,
    status: 'pre_approved',
    view: deriveResidencyView(f, true),
    preapprovalPaid: true,
    serviceFeeAmountUsdc: f.serviceFee.amountUsdc,
    preapprovalUsdc: 447,
    serviceFeeConfigured: true,
    selfConfigured: false,
    permit: {
      status: 'not-configured',
      reason: 'No permit issuance approval is recorded in this environment.',
    },
    ...overrides,
  };
}

/** Not registered: no Colosseum tier, nothing met. */
const NOT_REGISTERED = facts({
  tier: null,
  identity: null,
  qualified: { status: 'known', usd: 0 },
  review: 'pending',
  serviceFee: { recorded: false, verified: false, amountUsdc: 10 },
});

/** Registered, but the qualified position is below the 10 USDC minimum. */
const THRESHOLD = facts({
  qualified: { status: 'known', usd: 5 },
  review: 'pending',
  serviceFee: { recorded: false, verified: false, amountUsdc: 10 },
});

/** Funds met, but the review (and fee) are not: the pop-up state. */
const FUNDS_MET_NOT_ALL = facts({
  review: 'pending',
  serviceFee: { recorded: false, verified: false, amountUsdc: 10 },
});

/** All four real checks met. */
const ALL_MET = facts();

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.register.mockResolvedValue({ status: 'ok' });
  hoisted.sync.mockResolvedValue({
    status: 'ok',
    membership: {
      residentSince: new Date().toISOString(),
      citizenAt: null,
      passportSerial: null,
    } satisfies ColosseumMembership,
  });
});

afterEach(() => {
  cleanup();
});

describe('ColosseumScreen registration', () => {
  it('offers the register call-to-action and explains the 10 USDC tier', () => {
    render(<ColosseumScreen snapshot={snapshot(NOT_REGISTERED)} membership={null} />);

    const cta = screen.getByTestId('colosseum-register');
    expect(cta).toHaveTextContent(/Register for Colosseum Residency/i);
    expect(cta).toHaveTextContent(/10 USDC/);
    expect(cta).toHaveTextContent(/residency checks/i);
    expect(screen.queryByTestId('colosseum-threshold')).toBeNull();
  });

  it('registers through the server action and refreshes the route', async () => {
    render(<ColosseumScreen snapshot={snapshot(NOT_REGISTERED)} membership={null} />);

    fireEvent.click(
      screen.getByRole('button', { name: /Register for Colosseum Residency/i }),
    );

    await waitFor(() => expect(hoisted.register).toHaveBeenCalledTimes(1));
    expect(hoisted.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('ColosseumScreen threshold', () => {
  it('shows the 10 USDC minimum and the real qualified amount', () => {
    render(<ColosseumScreen snapshot={snapshot(THRESHOLD)} membership={null} />);

    expect(screen.getByTestId('colosseum-threshold')).toHaveTextContent(/10 USDC/);
    expect(screen.getByTestId('colosseum-qualified')).toHaveTextContent(
      /\$5 of \$10/,
    );
    expect(screen.queryByTestId('colosseum-steps')).toBeNull();
  });
});

describe('ColosseumScreen residency-steps pop-up', () => {
  it('points the resident to the residency steps when funds are met but not all checks', () => {
    render(
      <ColosseumScreen snapshot={snapshot(FUNDS_MET_NOT_ALL)} membership={null} />,
    );

    expect(screen.getByTestId('colosseum-steps')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/Complete your residency steps/i);
    expect(
      screen.getByRole('link', { name: /Go to Residency/i }),
    ).toHaveAttribute('href', '/residency');
  });
});

describe('ColosseumScreen congrats', () => {
  it('shows the congrats state and the exact 2-minute sentence when all four checks are met', async () => {
    render(<ColosseumScreen snapshot={snapshot(ALL_MET)} membership={null} />);

    const congrats = await screen.findByTestId('colosseum-congrats');
    expect(congrats).toHaveTextContent(/You’re a Colosseum Resident/);
    expect(congrats).toHaveTextContent(
      'Remain a compliant resident for 2 minutes to be eligible to become a Colosseum Citizen.',
    );
    // The clock is started from the server, not from a client-supplied value.
    expect(hoisted.sync).toHaveBeenCalledTimes(1);
  });
});
