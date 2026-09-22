import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { deriveResidencyView, type ResidencyFacts } from '@/lib/residency/checks';
import type { ResidencySnapshot } from '@/lib/residency/server';

/**
 * The Residency step renders the four checks, the service-fee gate, the permit
 * status and the tracker from the snapshot the server derived. The payment
 * control and the server actions are mocked, so the component's own gating and
 * copy are what is under test.
 */

const hoisted = vi.hoisted(() => ({
  refresh: vi.fn(),
  startSelf: vi.fn(),
  issuePermit: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: hoisted.refresh }),
}));
vi.mock('@/app/residency/actions', () => ({
  startSelfVerificationAction: hoisted.startSelf,
  issueResidencyPermitAction: hoisted.issuePermit,
}));
vi.mock('@/components/residency/ServiceFeePayment', () => ({
  ServiceFeePayment: ({ amountUsdc }: { amountUsdc: string }) => (
    <div data-testid="service-fee-payment">Send {amountUsdc} USDC</div>
  ),
}));

import { ResidencyStep } from '@/components/residency/ResidencyStep';

const NOW = new Date('2026-09-22T00:00:00Z');

function facts(overrides: Partial<ResidencyFacts> = {}): ResidencyFacts {
  return {
    tier: '3-year',
    identity: {
      over18: true,
      notSanctioned: true,
      selfNullifier: 'n',
      expiresAt: '2027-01-01T00:00:00Z',
    },
    qualifiedUsd: 300_000,
    review: 'cleared',
    serviceFee: { recorded: true, verified: true, amountUsdc: 10 },
    permit: { issued: false, uid: null },
    now: NOW,
    ...overrides,
  };
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
      usdcAddress="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
      explorerUrl="https://sepolia.etherscan.io"
      {...props}
    />,
  );
}

beforeEach(() => {
  hoisted.startSelf.mockResolvedValue({ status: 'not-configured' });
  hoisted.issuePermit.mockResolvedValue({
    status: 'not-configured',
    reason: 'No permit issuance approval is recorded.',
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ResidencyStep — checks', () => {
  it('shows all four checks as ready from record-backed facts', () => {
    renderStep();
    expect(screen.getByText('Identity (Self)')).toBeInTheDocument();
    expect(screen.getByText('Qualified holdings')).toBeInTheDocument();
    // These titles also label a tracker stage, so both are expected.
    expect(screen.getAllByText('Intake review').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Residency service fee').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ready')).toHaveLength(4);
  });

  it('shows identity as pending when no attestation is recorded', () => {
    renderStep(facts({ identity: null }));
    expect(
      screen.getAllByText(/identity verification has not started/i).length,
    ).toBeGreaterThan(0);
  });

  it('shows a below-tier balance as pending', () => {
    renderStep(facts({ qualifiedUsd: 100 }));
    expect(screen.getAllByText(/of \$280,000/).length).toBeGreaterThan(0);
  });

  it('shows the pre-approval banner until the fee verifies', () => {
    renderStep(facts(), { snapshot: snapshot(facts(), { preapprovalPaid: false }) });
    expect(screen.getByText(/pre-approval pending/i)).toBeInTheDocument();
  });
});

describe('ResidencyStep — service fee gate', () => {
  it('locks the service fee while a prerequisite is not green', () => {
    renderStep(
      facts({
        identity: null,
        serviceFee: { recorded: false, verified: false, amountUsdc: 10 },
      }),
    );
    expect(
      screen.getAllByText(
        /unlocks when identity, qualified holdings and intake review are green/i,
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId('service-fee-payment')).toBeNull();
  });

  it('offers the payment control once the prerequisites are green', () => {
    renderStep(facts({ serviceFee: { recorded: false, verified: false, amountUsdc: 10 } }));
    expect(screen.getByTestId('service-fee-payment')).toHaveTextContent('Send 10 USDC');
  });

  it('keeps the service fee locked until the pre-approval fee is verified', () => {
    const f = facts({ serviceFee: { recorded: false, verified: false, amountUsdc: 10 } });
    renderStep(f, { snapshot: snapshot(f, { preapprovalPaid: false }) });
    expect(screen.queryByTestId('service-fee-payment')).toBeNull();
  });

  it('shows the fee as verified instead of a payment control when paid', () => {
    renderStep();
    expect(screen.getAllByText(/service fee verified/i).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('service-fee-payment')).toBeNull();
  });

  it('says when the service fee is not configured', () => {
    renderStep(
      facts({ serviceFee: { recorded: false, verified: false, amountUsdc: null } }),
      { snapshot: snapshot(facts({ serviceFee: { recorded: false, verified: false, amountUsdc: null } })) },
    );
    expect(screen.getByText(/configured service fee could not be read/i)).toBeInTheDocument();
  });

  it('says payment is unconfigured rather than offering a broken control', () => {
    renderStep(
      facts({ serviceFee: { recorded: false, verified: false, amountUsdc: 10 } }),
      { paymentConfigured: false },
    );
    expect(screen.getByText(/payment is not configured in this environment/i)).toBeInTheDocument();
  });
});

describe('ResidencyStep — Self and permit actions', () => {
  it('reports the Self gate instead of a fabricated result', async () => {
    hoisted.startSelf.mockResolvedValue({ status: 'not-configured' });
    renderStep();

    fireEvent.click(screen.getByRole('button', { name: /verify with self/i }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/self is not configured/i),
    );
    expect(hoisted.startSelf).toHaveBeenCalled();
  });

  it('disables permit issuance until identity and service fee are met', () => {
    renderStep(facts({ identity: null }));
    expect(screen.getByRole('button', { name: /issue permit/i })).toBeDisabled();
  });

  it('attempts permit issuance when the checks are green and reports the gate', async () => {
    renderStep();
    const button = screen.getByRole('button', { name: /issue permit/i });
    expect(button).toBeEnabled();

    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/no permit issuance approval/i),
    );
    expect(hoisted.issuePermit).toHaveBeenCalled();
  });
});

describe('ResidencyStep — tracker', () => {
  it('renders all six stages derived from records', () => {
    renderStep();
    for (const title of [
      'Pre-approval fee',
      'Identity verified',
      'Qualified holdings funded',
      'Intake review',
      'Residency service fee',
      'Permit issued',
    ]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
  });
});
