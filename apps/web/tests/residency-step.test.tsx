import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { deriveResidencyView, type ResidencyFacts } from '@/lib/residency/checks';
import type { ResidencySnapshot } from '@/lib/residency/server';

/**
 * The Residency step (D16 / EXE-012), laid out to match the deployed baseline.
 *
 * The four readiness rows, the readiness pill and the service-fee card are the
 * reference's. The state behind each row is derived from the snapshot the server
 * assembled, and the payment control and server actions are mocked, so the
 * component's own gating and copy are what is under test.
 */

const hoisted = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  createSelf: vi.fn(),
  issuePermit: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: hoisted.refresh, push: hoisted.push }),
}));
vi.mock('@/app/residency/actions', () => ({
  createSelfSessionAction: hoisted.createSelf,
  issueResidencyPermitAction: hoisted.issuePermit,
}));
vi.mock('@/components/residency/ServiceFeePayment', () => ({
  ServiceFeePayment: ({ amountUsdc }: { amountUsdc: string }) => (
    <div data-testid="service-fee-payment">Send {amountUsdc} USDC</div>
  ),
}));

import { ResidencyStep } from '@/components/residency/ResidencyStep';

function facts(overrides: Partial<ResidencyFacts> = {}): ResidencyFacts {
  return {
    tier: '3-year',
    identity: {
      provider: 'self',
      status: 'valid',
      verifiedAt: '2026-09-20T00:00:00Z',
      selfNullifier: 'n',
    },
    qualifiedUsd: 300_000,
    review: 'cleared',
    serviceFee: { recorded: true, verified: true, amountUsdc: 10 },
    permit: { issued: false, uid: null },
    ...overrides,
  };
}

/** The not-yet-ready state: nothing green, the fee unpaid. */
function pendingFacts(overrides: Partial<ResidencyFacts> = {}): ResidencyFacts {
  return facts({
    identity: null,
    qualifiedUsd: 0,
    review: 'pending',
    serviceFee: { recorded: false, verified: false, amountUsdc: 10 },
    ...overrides,
  });
}

function snapshot(
  f: ResidencyFacts = facts(),
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

function renderStep(
  f: ResidencyFacts = facts(),
  props: Partial<ComponentProps<typeof ResidencyStep>> = {},
) {
  render(
    <ResidencyStep
      snapshot={snapshot(f)}
      network="Ethereum Sepolia"
      paymentConfigured
      treasuryAddress="0x37d9Bcb63118cbD2cdE1d0E24379a876d687738A"
      chainId={11155111}
      usdcAddress="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
      explorerUrl="https://sepolia.etherscan.io"
      {...props}
    />,
  );
}

beforeEach(() => {
  hoisted.createSelf.mockResolvedValue({ status: 'not-configured' });
  hoisted.issuePermit.mockResolvedValue({
    status: 'not-configured',
    reason: 'No permit issuance approval is recorded.',
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ResidencyStep — reference layout', () => {
  it('renders the heading, the readiness rows and the service-fee card', () => {
    renderStep(pendingFacts());
    expect(screen.getByRole('heading', { name: 'Start Residency' })).toBeInTheDocument();
    expect(
      screen.getByText(/clear all four checks, pay the service fee/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Before you can start')).toBeInTheDocument();
    expect(screen.getByText('Identity verified')).toBeInTheDocument();
    expect(
      screen.getByText('Qualified holdings meet 3-year tier'),
    ).toBeInTheDocument();
    expect(screen.getByText('Documents complete')).toBeInTheDocument();
    expect(screen.getByText('Intake review cleared')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify with Self' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move funds' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.getByText(/0 of 6 uploaded/)).toBeInTheDocument();
    expect(screen.getByText('Residency service fee')).toBeInTheDocument();
  });

  it('does not claim a submission before the permit exists', () => {
    renderStep(facts({ serviceFee: { recorded: false, verified: false, amountUsdc: 10 } }));
    expect(screen.getByRole('heading', { name: 'Start Residency' })).toBeInTheDocument();
    expect(screen.queryByText(/submitted · in review/i)).toBeNull();
    expect(
      screen.queryByText(/your package is with the immigration service/i),
    ).toBeNull();
  });

  it('counts readiness and locks the fee until the checks are green', () => {
    renderStep(pendingFacts());
    expect(screen.getAllByText('0 of 4 ready').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: /complete the checks above to unlock/i }),
    ).toBeDisabled();
  });

  it('marks a row Ready when its record is present', () => {
    renderStep(facts({ serviceFee: { recorded: false, verified: false, amountUsdc: 10 } }));
    expect(screen.getAllByText('Ready')).toHaveLength(3);
    expect(screen.getAllByText('3 of 4 ready').length).toBeGreaterThan(0);
  });

  it('shows the below-tier shortfall in the baseline wording', () => {
    renderStep(pendingFacts());
    expect(
      screen.getByText(/\$0 of \$280,000 · \$280,000 to go/),
    ).toBeInTheDocument();
  });

  it('shows the fee amount and the pre-approval paid line', () => {
    renderStep(facts({ serviceFee: { recorded: false, verified: false, amountUsdc: 10 } }));
    expect(screen.getByText('10 USDC')).toBeInTheDocument();
    expect(
      screen.getByText(/pre-approval fee already paid: 447 USDC/i),
    ).toBeInTheDocument();
  });
});

describe('ResidencyStep — service fee gate', () => {
  it('offers the payment control once the prerequisites are green', () => {
    renderStep(facts({ serviceFee: { recorded: false, verified: false, amountUsdc: 10 } }));
    expect(screen.getByTestId('service-fee-payment')).toHaveTextContent('Send 10 USDC');
  });

  it('keeps the fee locked until the pre-approval fee is verified', () => {
    const f = facts({ serviceFee: { recorded: false, verified: false, amountUsdc: 10 } });
    renderStep(f, { snapshot: snapshot(f, { preapprovalPaid: false }) });
    expect(screen.queryByTestId('service-fee-payment')).toBeNull();
    expect(
      screen.getByRole('button', { name: /complete the checks above to unlock/i }),
    ).toBeDisabled();
  });

  it('shows the fee as verified and offers permit issuance when paid', () => {
    renderStep();
    expect(screen.getAllByText(/service fee verified/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /issue permit/i })).toBeEnabled();
    expect(screen.queryByTestId('service-fee-payment')).toBeNull();
  });

  it('falls back to the locked control when payment is unconfigured', () => {
    renderStep(
      facts({ serviceFee: { recorded: false, verified: false, amountUsdc: 10 } }),
      { paymentConfigured: false },
    );
    expect(
      screen.getByRole('button', { name: /complete the checks above to unlock/i }),
    ).toBeDisabled();
  });
});

describe('ResidencyStep — actions', () => {
  it('Move funds navigates to holdings', () => {
    renderStep(pendingFacts());
    fireEvent.click(screen.getByRole('button', { name: 'Move funds' }));
    expect(hoisted.push).toHaveBeenCalledWith('/holdings');
  });

  it('opens the Self dialog and renders the real hosted link', async () => {
    hoisted.createSelf.mockResolvedValue({
      status: 'created',
      verificationUrl: 'https://self.xyz/v/abc',
      sessionId: 'sess_1',
    });
    renderStep(pendingFacts());

    fireEvent.click(screen.getByRole('button', { name: 'Verify with Self' }));
    expect(
      screen.getByRole('dialog', { name: /verify your identity/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Powered by Self')).toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: /open self to verify/i }),
      ).toHaveAttribute('href', 'https://self.xyz/v/abc'),
    );
    expect(hoisted.createSelf).toHaveBeenCalled();
  });

  it('says Self is not configured instead of rendering a flow that cannot work', async () => {
    hoisted.createSelf.mockResolvedValue({ status: 'not-configured' });
    renderStep(pendingFacts());

    fireEvent.click(screen.getByRole('button', { name: 'Verify with Self' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/self is not configured/i),
    );
    // No fabricated QR and no fabricated verification action.
    expect(
      screen.queryByRole('link', { name: /open self to verify/i }),
    ).toBeNull();
  });

  it('attempts permit issuance when paid and reports the gate', async () => {
    renderStep();
    fireEvent.click(screen.getByRole('button', { name: /issue permit/i }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/no permit issuance approval/i),
    );
    expect(hoisted.issuePermit).toHaveBeenCalled();
  });
});
