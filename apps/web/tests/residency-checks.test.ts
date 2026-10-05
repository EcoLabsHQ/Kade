import { describe, expect, it } from 'vitest';
import {
  deriveChecks,
  deriveResidencyView,
  deriveTracker,
  serviceFeeUnlocked,
  tierMinimumUsdc,
  type ResidencyFacts,
} from '@/lib/residency/checks';

/**
 * The residency checks and tracker are derived from records, never fixtures.
 * These tests drive the derivation directly with fact objects, so a state the
 * records cannot support is impossible to render.
 *
 * The qualified position is a `QualifiedPosition` (known figure or unknown with
 * a reason) produced by the same `summarizeQualifiedPosition` the Holdings card
 * uses; `residency-checks` therefore consumes the one value rather than a second
 * computation.
 */

function facts(overrides: Partial<ResidencyFacts> = {}): ResidencyFacts {
  return {
    tier: '3-year',
    identity: {
      provider: 'self',
      status: 'valid',
      verifiedAt: '2026-09-20T00:00:00Z',
      selfNullifier: 'nullifier-1',
    },
    qualified: { status: 'known', usd: 300_000 },
    review: 'cleared',
    serviceFee: { recorded: true, verified: true, amountUsdc: 10 },
    permit: { issued: false, uid: null },
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

  it('reads the Colosseum Resident demo tier at 10 USDC', () => {
    expect(tierMinimumUsdc('colosseum')).toBe(10);
  });

  it('leaves the three production tiers unchanged', () => {
    expect(tierMinimumUsdc('3-year')).toBe(280000);
    expect(tierMinimumUsdc('5-year')).toBe(425000);
    expect(tierMinimumUsdc('indefinite')).toBe(850000);
  });

  it('returns null for no tier or an unknown tier', () => {
    expect(tierMinimumUsdc(null)).toBeNull();
    expect(tierMinimumUsdc('platinum')).toBeNull();
  });
});

describe('deriveChecks — funds at the Colosseum tier', () => {
  it('is met at 10 USDC through the same funds check as the production tiers', () => {
    const result = check(
      facts({ tier: 'colosseum', qualified: { status: 'known', usd: 10 } }),
      'funds',
    );
    expect(result.state).toBe('met');
    expect(result.detail).toBe('$10.00 meets the tier.');
  });

  it('is pending below 10 USDC and names the Colosseum threshold', () => {
    const result = check(
      facts({ tier: 'colosseum', qualified: { status: 'known', usd: 4 } }),
      'funds',
    );
    expect(result.state).toBe('pending');
    expect(result.detail).toBe('$4.00 of $10.');
  });

  it('shows a fractional qualified balance with two decimals, not three', () => {
    // The reported defect: a $13.838 balance printed as "$13.838 meets the
    // tier." The display now rounds to two decimals; the value stays above the
    // $10 Colosseum minimum, so the outcome is unchanged.
    const result = check(
      facts({ tier: 'colosseum', qualified: { status: 'known', usd: 13.838 } }),
      'funds',
    );
    expect(result.state).toBe('met');
    expect(result.detail).toBe('$13.84 meets the tier.');
  });

  it('compares the unrounded balance, so a fractional figure just below the minimum stays pending', () => {
    // 9.999 displays as "$10.00" at two decimals but is below the $10 minimum:
    // rounding is for display only and must not change eligibility.
    const result = check(
      facts({ tier: 'colosseum', qualified: { status: 'known', usd: 9.999 } }),
      'funds',
    );
    expect(result.state).toBe('pending');
    expect(result.detail).toBe('$10.00 of $10.');
  });
});

describe('deriveChecks — identity', () => {
  it('is pending when no Self verification is recorded', () => {
    expect(check(facts({ identity: null }), 'identity').state).toBe('pending');
  });

  it('is met for a valid Self outcome', () => {
    expect(check(facts(), 'identity').state).toBe('met');
  });

  it('is blocked when Self reports the proof invalid', () => {
    const invalid = {
      provider: 'self' as const,
      status: 'invalid' as const,
      verifiedAt: null,
      selfNullifier: null,
    };
    expect(check(facts({ identity: invalid }), 'identity').state).toBe('blocked');
  });

  it('is blocked whenever the outcome is not affirmatively valid', () => {
    // Fail closed: only `valid` is met; anything else blocks rather than passes.
    const invalid = {
      provider: 'self' as const,
      status: 'invalid' as const,
      verifiedAt: null,
      selfNullifier: 'n',
    };
    expect(check(facts({ identity: invalid }), 'identity').state).not.toBe('met');
  });
});

describe('deriveChecks — funds', () => {
  it('is pending below the tier minimum', () => {
    expect(
      check(facts({ qualified: { status: 'known', usd: 100 } }), 'funds').state,
    ).toBe('pending');
  });

  it('is met at or above the tier minimum', () => {
    expect(
      check(facts({ qualified: { status: 'known', usd: 280000 } }), 'funds')
        .state,
    ).toBe('met');
    expect(
      check(facts({ qualified: { status: 'known', usd: 280001 } }), 'funds')
        .state,
    ).toBe('met');
  });

  it('is a real $0 when the vault read succeeded and holds nothing', () => {
    const result = check(facts({ qualified: { status: 'known', usd: 0 } }), 'funds');
    expect(result.state).toBe('pending');
    expect(result.detail).toBe('$0.00 of $280,000.');
  });

  it('keeps the specific reason and stays pending when the vault read failed — never a fabricated $0', () => {
    const reason = 'The vault balance on Ethereum could not be read.';
    const result = check(
      facts({ qualified: { status: 'unknown', reason } }),
      'funds',
    );
    expect(result.state).toBe('pending');
    expect(result.detail).toContain(reason);
    expect(result.detail).not.toContain('$0');
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
    expect(
      serviceFeeUnlocked(deriveChecks(facts({ qualified: { status: 'known', usd: 0 } }))),
    ).toBe(false);
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
