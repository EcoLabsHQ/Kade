import { describe, expect, it } from 'vitest';
import {
  applicantName,
  availableActions,
  feeState,
  residencyState,
  walletClass,
  wealthState,
  type ReviewQueueItem,
} from '@/lib/review/decision';
import { residentGate, residentGateLabel } from '@/lib/review/gate';
import { CONNECTED_WALLET_PROVIDER } from '@/lib/wealth/types';

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
    ).toEqual({ total: 2, verified: 1, connected: 0, pasted: 1 });
  });

  it('classifies verified, connected and pasted rows exactly', () => {
    const state = wealthState([
      { address: 'v', chain: 1, provider: 'pasted-address', verifiedAt: '2026-09-01' },
      { address: 'c', chain: 1, provider: CONNECTED_WALLET_PROVIDER, verifiedAt: null },
      { address: 'p', chain: 1, provider: 'pasted-address', verifiedAt: null },
      { address: 'b', chain: 0, provider: 'bitcoin-address', verifiedAt: null },
      { address: 'n', chain: 1, provider: null, verifiedAt: null },
    ]);

    expect(state).toEqual({ total: 5, verified: 1, connected: 1, pasted: 3 });
  });

  it('never counts a connected row as pasted or verified', () => {
    expect(
      wealthState([
        {
          address: '0xconnected',
          chain: 1,
          provider: CONNECTED_WALLET_PROVIDER,
          verifiedAt: null,
        },
      ]),
    ).toEqual({ total: 1, verified: 0, connected: 1, pasted: 0 });
  });

  it('counts a connected wallet that was later signature-verified as verified only', () => {
    expect(
      wealthState([
        {
          address: '0xconnected',
          chain: 1,
          provider: CONNECTED_WALLET_PROVIDER,
          verifiedAt: '2026-09-22T10:00:00.000Z',
        },
      ]),
    ).toEqual({ total: 1, verified: 1, connected: 0, pasted: 0 });
  });

  it('labels one row with exactly one class', () => {
    expect(
      walletClass({ address: 'a', chain: 1, provider: null, verifiedAt: '2026-09-01' }),
    ).toBe('verified');
    expect(
      walletClass({
        address: 'a',
        chain: 1,
        provider: CONNECTED_WALLET_PROVIDER,
        verifiedAt: null,
      }),
    ).toBe('connected');
    expect(
      walletClass({
        address: 'a',
        chain: 1,
        provider: CONNECTED_WALLET_PROVIDER,
        verifiedAt: '2026-09-22T10:00:00.000Z',
      }),
    ).toBe('verified');
    expect(
      walletClass({ address: 'a', chain: 1, provider: 'pasted-address', verifiedAt: null }),
    ).toBe('pasted');
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
