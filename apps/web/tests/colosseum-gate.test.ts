import { describe, expect, it } from 'vitest';
import { COLOSSEUM_ENV, isColosseumEnabled } from '@/lib/colosseum/gate';

/**
 * The Colosseum residency surface is off by default and enabled only by the
 * exact string `1` of `KADE_COLOSSEUM`, mirroring the operator-withdrawal gate.
 */
describe('isColosseumEnabled', () => {
  it('is enabled only for the exact string "1"', () => {
    expect(isColosseumEnabled({ [COLOSSEUM_ENV]: '1' })).toBe(true);
  });

  it('is off when the flag is unset or empty', () => {
    expect(isColosseumEnabled({})).toBe(false);
    expect(isColosseumEnabled({ [COLOSSEUM_ENV]: '' })).toBe(false);
  });

  it('is off for every other value, including truthy-looking ones', () => {
    for (const value of ['true', 'yes', 'on', 'TRUE', '0', ' 1', '1 ']) {
      expect(isColosseumEnabled({ [COLOSSEUM_ENV]: value })).toBe(false);
    }
  });

  it('is not turned on by an unrelated flag', () => {
    expect(isColosseumEnabled({ KADE_OPERATOR_WITHDRAW: '1' })).toBe(false);
  });
});
