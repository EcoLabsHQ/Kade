import { describe, expect, it } from 'vitest';
import {
  deriveChecks,
  deriveResidencyView,
  deriveTracker,
  serviceFeeUnlocked,
  sumQualifiedUsd,
  tierMinimumUsdc,
  type ResidencyFacts,
} from '@/lib/residency/checks';

/**
 * The residency checks and tracker are derived from records, never fixtures.
 * These tests drive the derivation directly with fact objects, so a state the
 * records cannot support is impossible to render.
 */

const NOW = new Date('2026-09-22T00:00:00Z');

function facts(overrides: Partial<ResidencyFacts> = {}): ResidencyFacts {
  return {
    tier: '3-year',
    identity: {
      over18: true,
      notSanctioned: true,
      selfNullifier: 'nullifier-1',
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

function check(f: ResidencyFacts, id: string) {
  const found = deriveChecks(f).find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id}`);
  return found;
}

describe('tierMinimumUsdc', () => {
  it('reads the frozen tier table, including the stored lower-case indefinite', () => {
    expect(tierMinimumUsdc('3-year')).toBe(280000);
    expect(tierMinimumUsdc('5-year')).toBe(425000);
    expect(tierMinimumUsdc('indefinite')).toBe(850000);
    expect(tierMinimumUsdc('INDEFINITE')).toBe(850000);
  });

  it('returns null for no tier or an unknown tier', () => {
    expect(tierMinimumUsdc(null)).toBeNull();
    expect(tierMinimumUsdc('platinum')).toBeNull();
  });
});

describe('sumQualifiedUsd', () => {
  it('sums positive numeric and string balances and ignores null/garbage', () => {
    expect(
      sumQualifiedUsd([
        { usd_value: 100 },
        { usd_value: '250.5' },
        { usd_value: null },
        { usd_value: -10 },
      ]),
    ).toBe(350.5);
  });
});

describe('deriveChecks — identity', () => {
  it('is pending when no attestation is recorded', () => {
    expect(check(facts({ identity: null }), 'identity').state).toBe('pending');
  });

  it('is met for a valid, unexpired proof', () => {
    expect(check(facts(), 'identity').state).toBe('met');
  });

  it('is blocked when the proof is expired', () => {
    const expired = {
      over18: true,
      notSanctioned: true,
      selfNullifier: 'n',
      expiresAt: '2025-01-01T00:00:00Z',
    };
    expect(check(facts({ identity: expired }), 'identity').state).toBe('blocked');
  });

  it('is blocked when the proof does not satisfy the checks', () => {
    const sanctioned = {
      over18: true,
      notSanctioned: false,
      selfNullifier: 'n',
      expiresAt: null,
    };
    expect(check(facts({ identity: sanctioned }), 'identity').state).toBe('blocked');
  });
});

describe('deriveChecks — funds', () => {
  it('is pending below the tier minimum', () => {
    expect(check(facts({ qualifiedUsd: 100 }), 'funds').state).toBe('pending');
  });

  it('is met at or above the tier minimum', () => {
    expect(check(facts({ qualifiedUsd: 280000 }), 'funds').state).toBe('met');
    expect(check(facts({ qualifiedUsd: 280001 }), 'funds').state).toBe('met');
  });

  it('is pending when nothing is recorded', () => {
    expect(check(facts({ qualifiedUsd: null }), 'funds').state).toBe('pending');
  });
});

describe('deriveChecks — review', () => {
  it('maps the application status', () => {
    expect(check(facts({ review: 'cleared' }), 'review').state).toBe('met');
    expect(check(facts({ review: 'blocked' }), 'review').state).toBe('blocked');
    expect(check(facts({ review: 'pending' }), 'review').state).toBe('pending');
  });
});

describe('deriveChecks — service fee', () => {
  it('is blocked when the fee is not configured', () => {
    const f = facts({
      serviceFee: { recorded: false, verified: false, amountUsdc: null },
    });
    expect(check(f, 'service-fee').state).toBe('blocked');
  });

  it('is pending when recorded but unverified', () => {
    const f = facts({
      serviceFee: { recorded: true, verified: false, amountUsdc: 10 },
    });
    expect(check(f, 'service-fee').state).toBe('pending');
  });

  it('is met only when the receipt verifies', () => {
    expect(check(facts(), 'service-fee').state).toBe('met');
  });
});

describe('serviceFeeUnlocked', () => {
  it('requires identity, funds and review to be met', () => {
    expect(serviceFeeUnlocked(deriveChecks(facts()))).toBe(true);
  });

  it('ignores the service fee check itself', () => {
    const f = facts({
      serviceFee: { recorded: false, verified: false, amountUsdc: 10 },
    });
    // The fee is unpaid, but that is not what unlocks it.
    expect(serviceFeeUnlocked(deriveChecks(f))).toBe(true);
  });

  it('stays locked while a prerequisite is pending or blocked', () => {
    expect(serviceFeeUnlocked(deriveChecks(facts({ qualifiedUsd: 0 })))).toBe(false);
    expect(serviceFeeUnlocked(deriveChecks(facts({ identity: null })))).toBe(false);
    expect(
      serviceFeeUnlocked(deriveChecks(facts({ review: 'blocked' }))),
    ).toBe(false);
  });
});

describe('deriveTracker', () => {
  it('derives six stages and marks record-backed stages done', () => {
    const tracker = deriveTracker(facts(), true);
    expect(tracker.map((s) => s.id)).toEqual([
      'pre-approval',
      'identity',
      'funds',
      'review',
      'service-fee',
      'permit',
    ]);
    expect(tracker.find((s) => s.id === 'pre-approval')?.state).toBe('done');
    expect(tracker.find((s) => s.id === 'service-fee')?.state).toBe('done');
    // No permit record exists, so the last stage is not done.
    expect(tracker.find((s) => s.id === 'permit')?.state).toBe('queued');
  });

  it('marks the permit stage done only when a permit is recorded', () => {
    const tracker = deriveTracker(
      facts({ permit: { issued: true, uid: '0xabc' } }),
      true,
    );
    const permit = tracker.find((s) => s.id === 'permit');
    expect(permit?.state).toBe('done');
    expect(permit?.meta).toContain('0xabc');
  });

  it('does not mark the pre-approval stage done until the fee is verified', () => {
    const tracker = deriveTracker(facts(), false);
    expect(tracker.find((s) => s.id === 'pre-approval')?.state).toBe('active');
  });
});

describe('deriveResidencyView', () => {
  it('exposes the checks, tracker and permit state together', () => {
    const view = deriveResidencyView(facts(), true);
    expect(view.checks).toHaveLength(4);
    expect(view.serviceFeeUnlocked).toBe(true);
    expect(view.permitIssued).toBe(false);
  });
});
