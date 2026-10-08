import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { deriveResidencyView, type ResidencyFacts } from '@/lib/residency/checks';
import {
  ColosseumResidency,
  type ClaimOutcomeView,
} from '@/components/residency/ColosseumResidency';

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

    // Once claimed, the pass is shown inline (feedback 3); re-opening it from
    // the card's overlay control must not call the mint again.
    fireEvent.click(
      screen.getByRole('button', { name: /open the residency pass full-screen/i }),
    );
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

    // The residency pass must be claimed first; the window starts on that claim.
    fireEvent.click(
      screen.getByRole('button', { name: /claim colosseum residency/i }),
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    onClaimMembership.mockClear();
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

describe('ColosseumResidency — the on-chain mint receipt (feedback 1)', () => {
  it('reports the confirmed credential honestly, with the serial/state and Arbiscan links', async () => {
    const onClaimMembership = vi.fn().mockResolvedValue({
      status: 'sent',
      sent: true,
      reason: 'The issue-resident transition was confirmed on chain.',
      operation: 'issue-resident',
      account: '0x1111111111111111111111111111111111111111',
      txHash: `0x${'ab'.repeat(32)}`,
      explorerUrl: 'https://arbiscan.io',
    });
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks()}
        profileKey="claim-receipt"
        onClaimMembership={onClaimMembership}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /claim colosseum residency/i }),
    );
    await act(async () => {});

    const receipt = screen.getByTestId('colosseum-mint-resident');
    expect(receipt).toHaveAttribute('data-state', 'sent');
    expect(receipt).toHaveTextContent(/issued on chain/i);
    // The serial/state the app already knows is repeated.
    expect(receipt).toHaveTextContent(/status: resident/i);
    expect(receipt).toHaveTextContent(/KADE-RES-/);

    // A real way to reach the credential: the issuance transaction and the
    // holder account on the membership chain's explorer.
    const links = within(receipt).getAllByRole('link');
    expect(links[0]).toHaveAttribute(
      'href',
      `https://arbiscan.io/tx/0x${'ab'.repeat(32)}`,
    );
    expect(links[1]).toHaveAttribute(
      'href',
      'https://arbiscan.io/address/0x1111111111111111111111111111111111111111',
    );
  });

  it('never claims issuance while the mint is still pending', async () => {
    let resolve!: (value: ClaimOutcomeView | null) => void;
    const onClaimMembership = vi.fn(
      () =>
        new Promise<ClaimOutcomeView | null>((r) => {
          resolve = r;
        }),
    );
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks()}
        profileKey="claim-pending"
        onClaimMembership={onClaimMembership}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /claim colosseum residency/i }),
    );

    const receipt = screen.getByTestId('colosseum-mint-resident');
    expect(receipt).toHaveAttribute('data-state', 'pending');
    expect(receipt).toHaveTextContent(/waiting for confirmation/i);
    expect(receipt).not.toHaveTextContent(/issued on chain/i);

    await act(async () => {
      resolve({
        status: 'sent',
        sent: true,
        reason: 'confirmed',
        explorerUrl: null,
      });
    });
    expect(screen.getByTestId('colosseum-mint-resident')).toHaveAttribute(
      'data-state',
      'sent',
    );
  });

  it('says the credential was NOT issued when the mint fails', async () => {
    const onClaimMembership = vi.fn().mockResolvedValue({
      status: 'failed',
      sent: false,
      reason: 'the owner-Safe transaction reverted.',
      txHash: null,
      explorerUrl: null,
    });
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks()}
        profileKey="claim-failed"
        onClaimMembership={onClaimMembership}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /claim colosseum residency/i }),
    );
    await act(async () => {});

    const receipt = screen.getByTestId('colosseum-mint-resident');
    expect(receipt).toHaveAttribute('data-state', 'failed');
    expect(receipt).toHaveTextContent(/not issued/i);
    expect(receipt).not.toHaveTextContent(/issued on chain/i);
  });

  it('shows no receipt before a claim has been submitted', () => {
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks()}
        profileKey="claim-before"
        onClaimMembership={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('colosseum-mint-resident')).toBeNull();
  });

  it('binds the receipt to the confirmed transition, not the client claim target', async () => {
    // The reported defect: after the citizenship claim the receipt still showed
    // the residency transaction under a Citizen label. The receipt must name the
    // credential the confirmed `operation` belongs to — here a Resident
    // transition answered to a Citizen claim — so the displayed hash is always
    // the hash of the action the label describes. Pre-fix the label came from
    // the client target, so this receipt rendered as
    // `colosseum-mint-citizen` / "Colosseum Citizen credential" over the
    // residency transaction.
    const RESIDENT_TX = `0x${'11'.repeat(32)}`;
    const onClaimMembership = vi.fn().mockResolvedValue({
      status: 'sent',
      sent: true,
      reason: 'The issue-resident transition was confirmed on chain.',
      operation: 'issue-resident',
      account: '0x1111111111111111111111111111111111111111',
      txHash: RESIDENT_TX,
      explorerUrl: 'https://arbiscan.io',
    });
    render(
      <ColosseumResidency
        tier="colosseum"
        checks={checks()}
        profileKey="claim-bound"
        onClaimMembership={onClaimMembership}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /claim colosseum residency/i }),
    );
    await act(async () => {});
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    onClaimMembership.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /become a citizen/i }));
    await act(async () => {});

    expect(onClaimMembership).toHaveBeenCalledWith('citizen');
    // No Citizen-labelled receipt may exist for a Resident transition…
    expect(screen.queryByTestId('colosseum-mint-citizen')).toBeNull();
    // …and the receipt that is shown names the credential the hash belongs to.
    const receipt = screen.getByTestId('colosseum-mint-resident');
    expect(receipt).toHaveTextContent(/Colosseum Resident credential/i);
    expect(receipt).toHaveTextContent(/Status: Resident/i);
    expect(
      within(receipt).getByRole('link', { name: /issuance transaction/i }),
    ).toHaveAttribute('href', `https://arbiscan.io/tx/${RESIDENT_TX}`);
  });
});
