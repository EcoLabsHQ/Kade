import { describe, expect, it } from 'vitest';
import {
  clearResidentSince,
  colosseumWindowAction,
  EMPTY_COLOSSEUM_PROGRESS,
  mergeColosseumProgress,
  type ColosseumProgress,
} from '../../apps/web/src/components/residency/colosseum-progress';

/**
 * Regression: the Colosseum compliance window's lifecycle.
 *
 * The claim-first reshaping moved the window start into the one-shot residency
 * claim handler while the decay effect could still clear the window many times.
 * That asymmetry — a window that could be started only once but cleared
 * repeatedly — dead-ended a claimed resident whose checks went red (or whose
 * first start write failed, or who reloaded): `residencyPassSerial` is sticky,
 * so the grey claim card never returned, and with no window `StateResident`
 * rendered only "Remain a compliant resident" with no Citizen button. The same
 * reshape let a window-start canonical snapshot (read before the pass existed)
 * replace the local state and un-record the just-claimed pass, re-arming the
 * claim and replaying its one-shot reveal.
 *
 * The fix makes the window's start a declarative function of
 * "eligible + claimed + windowless", so it can fire again; and merges canonical
 * snapshots forward only, so they can never regress a recorded milestone. This
 * file locks both invariants. It failed before the fix and must keep passing.
 */

function progress(overrides: Partial<ColosseumProgress> = {}): ColosseumProgress {
  return { ...EMPTY_COLOSSEUM_PROGRESS, ...overrides };
}

const CLAIMED: Partial<ColosseumProgress> = {
  residencyPassAt: '2026-03-01T00:00:00.000Z',
  residencyPassSerial: 'KADE-RES-ABCD2345',
};

describe('regression: an eligible, claimed, windowless resident can always (re)start the window', () => {
  it('starts the window for an eligible, claimed, windowless resident', () => {
    expect(
      colosseumWindowAction({
        eligible: true,
        citizen: false,
        hasWindow: false,
        passClaimed: true,
      }),
    ).toBe('start');
  });

  it('can start again after a decay cleared the window (no one-shot dead end)', () => {
    // A live window is decayed when a check stops being green...
    expect(
      colosseumWindowAction({
        eligible: false,
        citizen: false,
        hasWindow: true,
        passClaimed: true,
      }),
    ).toBe('clear');

    // ...and once the checks are green again the claimed, windowless resident is
    // started again. Before the fix this state said "idle", which is the dead
    // end that made the Citizen claim unreachable.
    expect(
      colosseumWindowAction({
        eligible: true,
        citizen: false,
        hasWindow: false,
        passClaimed: true,
      }),
    ).toBe('start');
  });

  it('never gives an unclaimed resident a pre-claim clock', () => {
    // The human's requirement: the claim is the trigger. Green checks alone must
    // not start the window.
    expect(
      colosseumWindowAction({
        eligible: true,
        citizen: false,
        hasWindow: false,
        passClaimed: false,
      }),
    ).toBe('idle');
  });

  it('keeps a citizen’s recorded window and does not clear it', () => {
    expect(
      colosseumWindowAction({
        eligible: true,
        citizen: true,
        hasWindow: true,
        passClaimed: true,
      }),
    ).toBe('idle');
  });
});

describe('regression: a canonical snapshot cannot un-record a claimed pass or a started window', () => {
  it('keeps the claimed pass when a window-start snapshot predates it', () => {
    const local = progress({
      ...CLAIMED,
      residentSince: '2026-03-01T00:02:00.000Z',
    });
    // The window start's canonical read was taken before the pass write: the
    // window is present, the pass is absent. Replacing the local state with this
    // is what reverted the claim and replayed it.
    const canonical = progress({ residentSince: '2026-03-01T00:02:00.000Z' });

    const merged = mergeColosseumProgress(local, canonical);
    expect(merged.residencyPassSerial).toBe('KADE-RES-ABCD2345');
    expect(merged.residencyPassAt).not.toBeNull();
    expect(merged.residentSince).toBe('2026-03-01T00:02:00.000Z');
  });

  it('keeps a started window when a pass snapshot predates it', () => {
    const local = progress({
      ...CLAIMED,
      residentSince: '2026-03-01T00:02:00.000Z',
    });
    // The pass write's canonical read was taken before the window start.
    const canonical = progress(CLAIMED);

    const merged = mergeColosseumProgress(local, canonical);
    expect(merged.residentSince).toBe('2026-03-01T00:02:00.000Z');
    expect(merged.residencyPassSerial).toBe('KADE-RES-ABCD2345');
  });

  it('still lets the decay clear the window, because the local clear is applied first', () => {
    // The decay optimistically clears the local window before the clear's
    // canonical snapshot is merged; the clear's canonical has no window, so the
    // window stays cleared.
    const cleared = clearResidentSince(
      progress({ ...CLAIMED, residentSince: '2026-03-01T00:02:00.000Z' }),
    );
    expect(cleared.residentSince).toBeNull();

    const canonicalAfterClear = progress(CLAIMED);
    const merged = mergeColosseumProgress(cleared, canonicalAfterClear);
    expect(merged.residentSince).toBeNull();
    // The claimed pass survives the decay clear.
    expect(merged.residencyPassSerial).toBe('KADE-RES-ABCD2345');
  });
});
