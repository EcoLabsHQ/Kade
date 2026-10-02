import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { deriveResidencyView, type ResidencyFacts } from '@/lib/residency/checks';
import type { ResidencySnapshot } from '@/lib/residency/server';
import type { ColosseumMembership } from '@/lib/colosseum/server';

/**
 * Colosseum citizenship: the persisted 2-minute window and the virtual passport.
 *
 * The countdown is cosmetic and derives from the server's `resident_since`; the
 * "Become a Citizen" control is gated until the window elapses, and the RPC (not
 * this component) is the authority. An already-citizen load shows the saved
 * passport directly, with no re-animation.
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

const ALL_MET: ResidencyFacts = {
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
};

function snapshot(): ResidencySnapshot {
  return {
    applicationId: 'app-1',
    applicationRef: 'CW-2026-0409',
    tier: ALL_MET.tier,
    status: 'pre_approved',
    view: deriveResidencyView(ALL_MET, true),
    preapprovalPaid: true,
    serviceFeeAmountUsdc: 10,
    preapprovalUsdc: 447,
    serviceFeeConfigured: true,
    selfConfigured: false,
    permit: {
      status: 'not-configured',
      reason: 'No permit issuance approval is recorded in this environment.',
    },
  };
}

function isoSecondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString();
}

function membership(
  overrides: Partial<ColosseumMembership> = {},
): ColosseumMembership {
  return {
    residentSince: isoSecondsAgo(0),
    citizenAt: null,
    passportSerial: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.sync.mockResolvedValue({
    status: 'ok',
    membership: membership(),
  });
});

afterEach(() => {
  cleanup();
});

describe('Colosseum citizenship countdown', () => {
  it('derives the countdown from the server resident_since', async () => {
    hoisted.sync.mockResolvedValue({
      status: 'ok',
      membership: membership({ residentSince: isoSecondsAgo(80) }),
    });

    render(<ColosseumScreen snapshot={snapshot()} membership={null} />);

    await screen.findByTestId('colosseum-congrats');
    // 80 seconds elapsed of 120 leaves ~40 seconds, never the full 2:00.
    expect(screen.getByTestId('colosseum-countdown')).toHaveTextContent(
      /^0:[34]\d$/,
    );
  });

  it('keeps "Become a Citizen" gated until the 2 minutes elapse', async () => {
    hoisted.sync.mockResolvedValue({
      status: 'ok',
      membership: membership({ residentSince: isoSecondsAgo(0) }),
    });

    render(<ColosseumScreen snapshot={snapshot()} membership={null} />);
    await screen.findByTestId('colosseum-congrats');

    expect(
      screen.getByRole('button', { name: /Become a Citizen/i }),
    ).toBeDisabled();
  });

  it('unlocks "Become a Citizen" once the window has elapsed', async () => {
    hoisted.sync.mockResolvedValue({
      status: 'ok',
      membership: membership({ residentSince: isoSecondsAgo(130) }),
    });

    render(<ColosseumScreen snapshot={snapshot()} membership={null} />);
    await screen.findByTestId('colosseum-congrats');

    expect(
      screen.getByRole('button', { name: /Become a Citizen/i }),
    ).toBeEnabled();
  });
});

describe('Colosseum passport', () => {
  it('shows the saved virtual passport after becoming a citizen', async () => {
    hoisted.sync.mockResolvedValue({
      status: 'ok',
      membership: membership({ residentSince: isoSecondsAgo(130) }),
    });
    hoisted.become.mockResolvedValue({
      status: 'ok',
      membership: membership({
        residentSince: isoSecondsAgo(130),
        citizenAt: new Date().toISOString(),
        passportSerial: 'KADE-CL-ABCDEF123456',
      }),
    });

    render(<ColosseumScreen snapshot={snapshot()} membership={null} />);
    await screen.findByTestId('colosseum-congrats');

    fireEvent.click(screen.getByRole('button', { name: /Become a Citizen/i }));

    await waitFor(() => expect(hoisted.become).toHaveBeenCalledTimes(1));
    const passport = await screen.findByTestId('colosseum-passport');
    expect(passport).toHaveAttribute('data-animate', 'true');
    expect(passport.className).toContain('kade-passport-reveal');
    expect(screen.getByTestId('colosseum-passport-serial')).toHaveTextContent(
      'KADE-CL-ABCDEF123456',
    );
  });

  it('shows an already-citizen passport on load without re-animating', () => {
    render(
      <ColosseumScreen
        snapshot={snapshot()}
        membership={membership({
          residentSince: isoSecondsAgo(600),
          citizenAt: isoSecondsAgo(500),
          passportSerial: 'KADE-CL-OLD0000000000',
        })}
      />,
    );

    const passport = screen.getByTestId('colosseum-passport');
    expect(passport).toHaveAttribute('data-animate', 'false');
    expect(passport.className).not.toContain('kade-passport-reveal');
    expect(screen.getByTestId('colosseum-passport-serial')).toHaveTextContent(
      'KADE-CL-OLD0000000000',
    );
    // No clock is started for a resident who is already a citizen.
    expect(hoisted.sync).not.toHaveBeenCalled();
  });

  it('surfaces a server refusal honestly when citizenship is refused', async () => {
    hoisted.sync.mockResolvedValue({
      status: 'ok',
      membership: membership({ residentSince: isoSecondsAgo(130) }),
    });
    hoisted.become.mockResolvedValue({
      status: 'refused',
      reason:
        'The 2-minute compliance window has not elapsed yet, so you are not eligible to become a Colosseum Citizen.',
    });

    render(<ColosseumScreen snapshot={snapshot()} membership={null} />);
    await screen.findByTestId('colosseum-congrats');

    fireEvent.click(screen.getByRole('button', { name: /Become a Citizen/i }));

    expect(
      await screen.findByTestId('colosseum-notice'),
    ).toHaveTextContent(/2-minute compliance window has not elapsed/i);
    expect(screen.queryByTestId('colosseum-passport')).toBeNull();
  });
});
