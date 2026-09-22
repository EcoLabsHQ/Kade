import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReviewQueueItem } from '@/lib/review/decision';

/**
 * The Admin queue component.
 *
 * It is presentation plus the three actions; it must never write status itself.
 * The server action is mocked, so this pins that a click calls `submitReview`
 * with the application id and the chosen action, and reports the gated
 * attestation honestly.
 */

const hoisted = vi.hoisted(() => ({ submitReview: vi.fn() }));

vi.mock('@/app/admin/review-actions', () => ({
  submitReview: hoisted.submitReview,
}));

import { ReviewQueue } from '@/components/admin/ReviewQueue';

const ITEM: ReviewQueueItem = {
  application: {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ref: 'CW-2026-0409',
    tier: '3-year',
    status: 'pre_approved',
    preapprovalUsdc: 1.75,
    serviceUsdc: null,
    feeTx: '0xabc',
    reviewUid: null,
    serviceUid: null,
  },
  applicant: {
    id: 'user-1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.test',
  },
  wallets: [{ address: '0x1111111111111111111111111111111111111111', chain: 1, provider: 'pasted-address', verifiedAt: null }],
  identity: null,
  residences: [{ countryCode: 'NL', fromYear: 2020, toYear: null }],
  citizenships: ['NL'],
  latestReview: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.submitReview.mockResolvedValue({
    reviewEventId: 1,
    attestation: 'blocked',
    attestationUid: null,
  });
});

describe('ReviewQueue', () => {
  it('shows the applicant and the decide fields', () => {
    render(<ReviewQueue items={[ITEM]} />);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText(/1\.75 USDC/)).toBeInTheDocument();
    expect(screen.getByText(/1 residence/)).toBeInTheDocument();
  });

  it('calls submitReview with the application and action, then reports the gate', async () => {
    render(<ReviewQueue items={[ITEM]} />);

    fireEvent.click(screen.getByRole('button', { name: 'approve' }));

    await waitFor(() =>
      expect(hoisted.submitReview).toHaveBeenCalledWith({
        applicationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        action: 'approve',
      }),
    );
    expect(
      await screen.findByText(/kade\.review\.v1 issuance blocked/i),
    ).toBeInTheDocument();
  });

  it('shows an empty state with no applications', () => {
    render(<ReviewQueue items={[]} />);
    expect(screen.getByText(/No applications are waiting/i)).toBeInTheDocument();
  });
});
