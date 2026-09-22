import { describe, expect, it } from 'vitest';
import {
  applicantName,
  availableActions,
  feeState,
  residencyState,
  wealthState,
  type ReviewQueueItem,
} from '@/lib/review/decision';
import { residentGate, residentGateLabel } from '@/lib/review/gate';

/**
 * Pure derivations behind the Admin queue and the resident gate.
 *
 * No database and no browser: these are the fields the reviewer decides on and
 * the status the resident sees, so they are asserted directly.
 */

function item(overrides: Partial<ReviewQueueItem> = {}): ReviewQueueItem {
  return {
    application: {
      id: 'app-1',
      ref: 'CW-2026-0409',
      tier: '3-year',
      status: 'pre_approved',
      preapprovalUsdc: 1.75,
      serviceUsdc: null,
      feeTx: null,
      reviewUid: null,
      serviceUid: null,
    },
    applicant: {
      id: 'user-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.test',
    },
    wallets: [],
    identity: null,
    residences: [],
    citizenships: [],
    latestReview: null,
    ...overrides,
  };
}

describe('queue derivations', () => {
  it('names the applicant, falling back to email then id', () => {
    expect(applicantName(item().applicant)).toBe('Ada Lovelace');
    expect(
      applicantName({ id: 'u', firstName: null, lastName: null, email: 'a@b.c' }),
    ).toBe('a@b.c');
  });

  it('reports a fee as recorded only when a hash exists, and never verifies it', () => {
    expect(feeState(item().application)).toEqual({
      kind: 'none',
      amountUsdc: 1.75,
    });
    expect(
      feeState({ ...item().application, feeTx: '0xabc' }),
    ).toEqual({ kind: 'recorded', amountUsdc: 1.75, txHash: '0xabc' });
  });

  it('separates verified wallets from pasted addresses', () => {
    expect(
      wealthState([
        { address: 'a', chain: 1, provider: null, verifiedAt: null },
        { address: 'b', chain: 1, provider: null, verifiedAt: '2026-09-01' },
      ]),
    ).toEqual({ total: 2, verified: 1, pasted: 1 });
  });

  it('derives the four residency checks from real rows', () => {
    const state = residencyState(
      item({
        identity: {
          nationality: 'NL',
          over18: true,
          notSanctioned: true,
          expiresAt: null,
          attestationUid: '0xuid',
        },
        residences: [{ countryCode: 'NL', fromYear: 2020, toYear: null }],
        citizenships: ['NL'],
      }),
    );
    expect(state.identityVerified).toBe(true);
    expect(state.residences).toBe(1);
    expect(state.checks).toEqual([
      { label: 'Identity', met: true },
      { label: 'Funds', met: true },
      { label: 'Review', met: false },
      { label: 'Service fee', met: false },
    ]);
  });

  it('offers actions that match the current status', () => {
    expect(availableActions('pre_approved')).toEqual(['approve', 'block']);
    expect(availableActions('approved')).toEqual(['block', 'reopen']);
    expect(availableActions('blocked')).toEqual(['reopen', 'approve']);
  });
});

describe('resident gate', () => {
  it('maps the trigger-written status to the resident gate', () => {
    expect(residentGate('approved')).toBe('approved');
    expect(residentGate('blocked')).toBe('blocked');
    expect(residentGate('pre_approved')).toBe('pending');
    expect(residentGate(null)).toBe('unknown');
  });

  it('labels each gate for the resident', () => {
    expect(residentGateLabel('approved')).toBe('Approved');
    expect(residentGateLabel('blocked')).toBe('Blocked');
    expect(residentGateLabel('unknown')).toBe('Not submitted');
  });
});
