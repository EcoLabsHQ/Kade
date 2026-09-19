import { describe, expect, it } from 'vitest';
import {
  FEE_KEYS,
  preapprovalFeeBreakdown,
  feeScheduleFor,
  preapprovalFeeUsdc,
  productionEquivalentUsdc,
  residencyServiceFeeUsdc,
  XCG_PER_USDC,
} from '../src/index.js';

/**
 * The fee model is frozen in docs/week-1-frozen-delivery-contract.md
 * section 2.1. The two worked examples in that table are the acceptance
 * criteria; they are asserted directly.
 */
describe('pre-approval fee', () => {
  it('demo: household of 3 yields 1.75 USDC (contract section 2.1)', () => {
    expect(preapprovalFeeUsdc('demo', 3)).toBe(1.75);
  });

  it('demo: is exactly 1.00 + 0.25 x household_size', () => {
    for (const size of [1, 2, 3, 4, 5, 10]) {
      expect(preapprovalFeeUsdc('demo', size)).toBeCloseTo(1 + 0.25 * size, 10);
    }
  });

  it('demo: an applicant-only household pays 1.25 USDC', () => {
    // The applicant is included in household_size (contract section 2.1).
    expect(preapprovalFeeUsdc('demo', 1)).toBe(1.25);
  });

  it('production: household of 3 yields 447 USDC (contract section 2.1)', () => {
    expect(preapprovalFeeUsdc('production', 3)).toBe(447);
  });

  it('production: derives from the DOCX XCG table at the CBCS peg', () => {
    expect(XCG_PER_USDC).toBe(1.79);
    for (const size of [1, 2, 3, 4]) {
      expect(preapprovalFeeUsdc('production', size)).toBe(
        Math.round((500 + 100 * size) / 1.79),
      );
    }
  });

  it('rejects a household size below 1 or non-integer', () => {
    expect(() => preapprovalFeeUsdc('demo', 0)).toThrow(RangeError);
    expect(() => preapprovalFeeUsdc('demo', 1.5)).toThrow(RangeError);
  });
});

describe('residency service fee', () => {
  it('demo is 10 USDC and production is 2,000 USDC (contract section 2.1)', () => {
    expect(residencyServiceFeeUsdc('demo')).toBe(10);
    expect(residencyServiceFeeUsdc('production')).toBe(2000);
  });
});

describe('fee schedule', () => {
  it('carries exactly the two Week 1 fee keys, in both modes', () => {
    for (const mode of ['demo', 'production'] as const) {
      const schedule = feeScheduleFor(mode);
      expect(schedule.map((f) => f.key)).toEqual([FEE_KEYS.preapproval, FEE_KEYS.service]);
      expect(schedule.every((f) => f.mode === mode)).toBe(true);
      expect(schedule.every((f) => f.currency === 'USDC')).toBe(true);
    }
  });

  it('records the production equivalent for a demo amount', () => {
    expect(productionEquivalentUsdc(3).value).toBe(447);
    expect(productionEquivalentUsdc(3).provenance).toBe('documented');
  });
});

describe('pre-approval breakdown', () => {
  it('splits the demo fee into base and per-member parts', () => {
    const breakdown = preapprovalFeeBreakdown('demo', 3);
    expect(breakdown.baseUsdc).toBe(1);
    expect(breakdown.perMemberUsdc).toBe(0.25);
    expect(breakdown.extraMembers).toBe(2);
    expect(breakdown.totalUsdc).toBe(1.75);
  });

  it('agrees with preapprovalFeeUsdc for every size and mode', () => {
    // A receipt that disagrees with the charge would be a false statement.
    for (const mode of ['demo', 'production'] as const) {
      for (let size = 1; size <= 200; size += 1) {
        expect(preapprovalFeeBreakdown(mode, size).totalUsdc).toBe(
          preapprovalFeeUsdc(mode, size),
        );
      }
    }
  });

  it('rejects a household size below 1', () => {
    expect(() => preapprovalFeeBreakdown('demo', 0)).toThrow(RangeError);
  });
});
