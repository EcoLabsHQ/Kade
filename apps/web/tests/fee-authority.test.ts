import { describe, expect, it } from 'vitest';
import { preapprovalFeeUsdc } from '@kade/shared';
import {
  assertNoClientSuppliedAmount,
  authoritativeFeeAmounts,
  authoritativePreapprovalFee,
} from '@/server/fee-authority';

describe('authoritative fee', () => {
  it('matches the frozen shared formula (demo household of 3 -> 1.75)', () => {
    expect(authoritativePreapprovalFee({ mode: 'demo', householdSize: 3 })).toBe(
      1.75,
    );
    expect(authoritativePreapprovalFee({ mode: 'demo', householdSize: 3 })).toBe(
      preapprovalFeeUsdc('demo', 3),
    );
  });

  it('matches the documented production example (household of 3 -> 447)', () => {
    expect(
      authoritativePreapprovalFee({ mode: 'production', householdSize: 3 }),
    ).toBe(447);
  });

  it('cannot be overridden by a client-supplied amount', () => {
    const tampered = { mode: 'demo', householdSize: 3, amount: 0.01 } as const;
    expect(() => authoritativePreapprovalFee(tampered)).toThrow(
      /client may not supply the fee/i,
    );
  });

  it('rejects every forbidden fee key', () => {
    for (const key of ['amount', 'fee', 'total', 'value', 'usdc']) {
      expect(() => assertNoClientSuppliedAmount({ [key]: 1 })).toThrow();
    }
    expect(() => assertNoClientSuppliedAmount({ householdSize: 3 })).not.toThrow();
  });

  it('exposes the seeded service fee without charging it in Week 1', () => {
    const fees = authoritativeFeeAmounts('demo', 3);
    expect(fees.preapproval.amount).toBe(1.75);
    expect(fees.service.amount).toBe(10);
  });
});
