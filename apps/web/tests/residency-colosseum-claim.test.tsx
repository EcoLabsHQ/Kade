import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { deriveResidencyView, type ResidencyFacts } from '@/lib/residency/checks';
import { ColosseumResidency } from '@/components/residency/ColosseumResidency';

/**
 * The claim → mint wiring.
 *
 * The claim is the trigger: `onClaimMembership` is called once, on the first
 * claim of each milestone, and never on a re-open. The existing reveal still
 * fires on the same tick — the mint callback is fire-and-forget and must not
 * change the reveal timing or the one-shot guards.
 */

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

function checks(f: ResidencyFacts = facts()) {
  return deriveResidencyView(f, true).checks;
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('ColosseumResidency — claim triggers the mint', () => {
  it('calls onClaimMembership with "resident" on the first claim and opens the reveal', () => {
    const onClaimMembership = vi.fn();
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks()}
        profileKey="claim-resident"
        onClaimMembership={onClaimMembership}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /claim colosseum residency/i }),
    );

    expect(onClaimMembership).toHaveBeenCalledTimes(1);
    expect(onClaimMembership).toHaveBeenCalledWith('resident');
    // The reveal still fires on the same tick.
    expect(
      screen.getByTestId('colosseum-residency-pass-overlay'),
    ).toBeInTheDocument();
  });

  it('does not mint again when the claimed pass is merely re-opened', () => {
    const onClaimMembership = vi.fn();
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks()}
        profileKey="claim-reopen"
        onClaimMembership={onClaimMembership}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /claim colosseum residency/i }),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClaimMembership).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /view residency pass/i }));
    expect(onClaimMembership).toHaveBeenCalledTimes(1);
  });

  it('calls onClaimMembership with "citizen" and still reveals the certificate', () => {
    const onClaimMembership = vi.fn();
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks()}
        profileKey="claim-citizen"
        onClaimMembership={onClaimMembership}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    fireEvent.click(screen.getByRole('button', { name: /become a citizen/i }));

    expect(onClaimMembership).toHaveBeenCalledTimes(1);
    expect(onClaimMembership).toHaveBeenCalledWith('citizen');
    expect(screen.getByTestId('colosseum-certificate-overlay')).toBeInTheDocument();
  });

  it('never calls the mint when the four checks are not all met', () => {
    const onClaimMembership = vi.fn();
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks(facts({ review: 'pending' }))}
        profileKey="claim-unmet"
        onClaimMembership={onClaimMembership}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /claim colosseum residency/i }),
    ).toBeNull();
    expect(onClaimMembership).not.toHaveBeenCalled();
  });

  it('renders without an onClaimMembership (the demo-only surface)', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks()}
        profileKey="claim-none"
      />,
    );
    expect(() =>
      fireEvent.click(
        screen.getByRole('button', { name: /claim colosseum residency/i }),
      ),
    ).not.toThrow();
  });
});
