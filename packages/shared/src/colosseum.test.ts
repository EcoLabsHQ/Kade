import { describe, expect, it } from 'vitest';
import {
  COLOSSEUM_TIER,
  TIERS,
  TIER_DATABASE_VALUES,
  tierDatabaseValue,
} from './index.js';

/**
 * The Colosseum tier is a separate, documented constant rather than a fourth
 * entry in `TIERS`. These tests pin both halves of that decision: the constant
 * names the Colosseum tier and its 10 USDC minimum, and the frozen production
 * tier table is untouched.
 */
describe('COLOSSEUM_TIER', () => {
  it('names the Colosseum tier and its 10 USDC minimum', () => {
    expect(COLOSSEUM_TIER).toEqual({ name: 'colosseum', minUsdc: 10 });
  });

  it('leaves the three production tiers frozen', () => {
    expect(TIERS).toEqual([
      { index: 0, name: '3-year', minUsdc: 280000 },
      { index: 1, name: '5-year', minUsdc: 425000 },
      { index: 2, name: 'Indefinite', minUsdc: 850000 },
    ]);
    expect(tierDatabaseValue(0)).toBe('3-year');
    expect(tierDatabaseValue(1)).toBe('5-year');
    expect(tierDatabaseValue(2)).toBe('indefinite');
    expect(TIER_DATABASE_VALUES[2]?.value).toBe('indefinite');
  });

  it('does not reuse the prototype tier index encoding', () => {
    // `colosseum` is a database string, not one of the frozen `TierIndex`
    // values; the constant must not imply a fourth index.
    expect(COLOSSEUM_TIER.name).toBe('colosseum');
    const productionNames: readonly string[] = TIERS.map((tier) => tier.name);
    expect(productionNames).not.toContain(COLOSSEUM_TIER.name);
  });
});
