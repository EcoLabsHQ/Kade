import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Colosseum demo state's server store.
 *
 * These tests drive the store against an in-memory fake of the two tables and
 * the resident-scoped writers, so they prove the properties the move to the
 * server is for:
 *
 *   - the state round-trips through the server (write, then read the same);
 *   - two requests for the SAME account see the SAME state, so two browsers
 *     signed into one account agree and clearing a browser changes nothing;
 *   - the state is per account: one account's writes never leak into another;
 *   - the writers are idempotent: a second claim keeps the first serial/instant;
 *   - `residentSince` is the existing `applications.colosseum_resident_since`
 *     column (the Citizen mint's compliance window), not a second field.
 */

const state = vi.hoisted(() => ({
  // The "signed-in" account the fake cookie client's writers act as (auth.uid()).
  current: 'profile-a',
  // applications.colosseum_resident_since, per profile.
  windows: new Map<string, string | null>(),
  // colosseum_progress, per profile.
  progress: new Map<string, Record<string, unknown>>(),
  // The four checks the mocked loadResidencySnapshot reports. All met by default.
  checks: [
    { id: 'identity', state: 'met' },
    { id: 'funds', state: 'met' },
    { id: 'review', state: 'met' },
    { id: 'service-fee', state: 'met' },
  ] as Array<{ id: string; state: string }>,
}));

// The server-side eligibility re-derivation reads the four checks from the same
// source the mint uses; the test injects them.
vi.mock('@/lib/residency/server', () => ({
  loadResidencySnapshot: async () => ({ view: { checks: state.checks } }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from(table: string) {
      return {
        select: () => ({
          eq: (_column: string, value: string) => ({
            maybeSingle: async () => {
              if (table === 'applications') {
                return {
                  data: {
                    colosseum_resident_since: state.windows.get(value) ?? null,
                  },
                  error: null,
                };
              }
              if (table === 'colosseum_progress') {
                return { data: state.progress.get(value) ?? null, error: null };
              }
              return { data: null, error: null };
            },
          }),
        }),
      };
    },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      const profile = state.current;
      const now = new Date().toISOString();
      const existing = state.progress.get(profile) ?? {};
      switch (name) {
        case 'clear_colosseum_window':
          if (!existing.citizen_at) state.windows.set(profile, null);
          break;
        case 'claim_colosseum_residency_pass':
          state.progress.set(profile, {
            ...existing,
            residency_pass_at: existing.residency_pass_at ?? now,
            residency_pass_serial:
              existing.residency_pass_serial ?? args.p_serial,
          });
          break;
        case 'become_colosseum_citizen':
          state.progress.set(profile, {
            ...existing,
            citizen_at: existing.citizen_at ?? now,
            passport_serial: existing.passport_serial ?? args.p_serial,
          });
          break;
        case 'set_colosseum_documents_complete':
          state.progress.set(profile, {
            ...existing,
            documents_complete: args.p_complete === true,
          });
          break;
        default:
          return { error: { message: `unexpected rpc ${name}` } };
      }
      return { error: null };
    },
  }),
  // The service-role writer the window start goes through (no resident session).
  createSupabaseServiceClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      if (name === 'record_colosseum_resident_since') {
        const profile = String(args.p_profile_id);
        if ((state.windows.get(profile) ?? null) === null) {
          state.windows.set(profile, new Date().toISOString());
        }
        return { error: null };
      }
      return { error: { message: `unexpected service rpc ${name}` } };
    },
  }),
}));

import {
  becomeColosseumCitizen,
  claimColosseumResidencyPass,
  clearColosseumWindow,
  ColosseumWindowNotEligibleError,
  EMPTY_COLOSSEUM_STATE,
  loadColosseumState,
  setColosseumDocumentsComplete,
  startColosseumWindow,
} from '@/lib/residency/colosseum-state-server';
import { complianceWindowElapsed } from '@/lib/membership/mint';

const ELIGIBLE_CHECKS = [
  { id: 'identity', state: 'met' },
  { id: 'funds', state: 'met' },
  { id: 'review', state: 'met' },
  { id: 'service-fee', state: 'met' },
];

beforeEach(() => {
  state.current = 'profile-a';
  state.windows.clear();
  state.progress.clear();
  state.checks = [...ELIGIBLE_CHECKS];
});

describe('colosseum state server store — round-trip', () => {
  it('reads back exactly what each writer recorded for the account', async () => {
    const started = await startColosseumWindow('profile-a');
    expect(started.progress.residentSince).not.toBeNull();

    const claimed = await claimColosseumResidencyPass('profile-a', 'KADE-RES-ABCD2345');
    expect(claimed.progress.residencyPassSerial).toBe('KADE-RES-ABCD2345');
    expect(claimed.progress.residencyPassAt).not.toBeNull();
    // The window is untouched by the pass claim.
    expect(claimed.progress.residentSince).toBe(started.progress.residentSince);

    const citizen = await becomeColosseumCitizen('profile-a', 'KADE-CL-ABCD2345');
    expect(citizen.progress.citizenAt).not.toBeNull();
    expect(citizen.progress.passportSerial).toBe('KADE-CL-ABCD2345');

    const documents = await setColosseumDocumentsComplete('profile-a', true);
    expect(documents.documentsComplete).toBe(true);

    const reread = await loadColosseumState('profile-a');
    expect(reread).toEqual(documents);
    expect(reread.progress.citizenAt).not.toBeNull();
    expect(reread.progress.residencyPassSerial).toBe('KADE-RES-ABCD2345');
  });

  it('reads the compliance window from applications.colosseum_resident_since', async () => {
    // A window recorded by the service-side writer (the Resident mint) is read
    // back as the same `residentSince`, so the demo clock and the mint's window
    // are one record.
    const since = '2026-01-01T00:00:00.000Z';
    state.windows.set('profile-a', since);

    const loaded = await loadColosseumState('profile-a');
    expect(loaded.progress.residentSince).toBe(since);
  });
});

describe('colosseum state server store — per account', () => {
  it('shows two requests for the SAME account the SAME state', async () => {
    await startColosseumWindow('profile-a');
    await claimColosseumResidencyPass('profile-a', 'KADE-RES-ABCD2345');
    await becomeColosseumCitizen('profile-a', 'KADE-CL-ABCD2345');

    // Two independent reads, as two browsers/requests would make.
    const browserOne = await loadColosseumState('profile-a');
    const browserTwo = await loadColosseumState('profile-a');

    expect(browserOne).toEqual(browserTwo);
    expect(browserOne.progress.citizenAt).not.toBeNull();
    expect(browserOne.progress.passportSerial).toBe('KADE-CL-ABCD2345');
  });

  it('never leaks one account’s state into another', async () => {
    await startColosseumWindow('profile-a');
    await claimColosseumResidencyPass('profile-a', 'KADE-RES-ABCD2345');

    // A different signed-in account sees its own (empty) state.
    state.current = 'profile-b';
    const other = await loadColosseumState('profile-b');
    expect(other).toEqual(EMPTY_COLOSSEUM_STATE);
  });

  it('scopes a writer to the signed-in account, ignoring a passed profile id', async () => {
    // The writers derive the account from auth.uid() (the fake's `current`), so a
    // call made while signed in as B writes B, even though A's id is passed for
    // the read-back.
    state.current = 'profile-b';
    await claimColosseumResidencyPass('profile-a', 'KADE-RES-ABCD2345');

    state.current = 'profile-b';
    expect((await loadColosseumState('profile-b')).progress.residencyPassSerial).toBe(
      'KADE-RES-ABCD2345',
    );
    state.current = 'profile-a';
    expect((await loadColosseumState('profile-a')).progress.residencyPassSerial).toBeNull();
  });
});

describe('colosseum state server store — idempotency and decay', () => {
  it('keeps the first residency-pass serial and instant on a second claim', async () => {
    const first = await claimColosseumResidencyPass('profile-a', 'KADE-RES-AAAA1111');
    const second = await claimColosseumResidencyPass('profile-a', 'KADE-RES-BBBB2222');

    expect(second.progress.residencyPassSerial).toBe('KADE-RES-AAAA1111');
    expect(second.progress.residencyPassAt).toBe(first.progress.residencyPassAt);
  });

  it('keeps the first citizenship serial and instant on a second claim', async () => {
    const first = await becomeColosseumCitizen('profile-a', 'KADE-CL-AAAA1111');
    const second = await becomeColosseumCitizen('profile-a', 'KADE-CL-BBBB2222');

    expect(second.progress.passportSerial).toBe('KADE-CL-AAAA1111');
    expect(second.progress.citizenAt).toBe(first.progress.citizenAt);
  });

  it('clears the window before citizenship but never after it', async () => {
    await startColosseumWindow('profile-a');
    const cleared = await clearColosseumWindow('profile-a');
    expect(cleared.progress.residentSince).toBeNull();

    await startColosseumWindow('profile-a');
    await becomeColosseumCitizen('profile-a', 'KADE-CL-ABCD2345');
    const afterCitizen = await clearColosseumWindow('profile-a');
    // A citizen keeps the record.
    expect(afterCitizen.progress.residentSince).not.toBeNull();
  });
});

/**
 * The security invariant the review flagged: the compliance window is a GATE,
 * not a demo value, so a signed-in resident must not be able to start it before
 * the four real checks are green. The start re-derives the checks server-side
 * and writes through the service-role writer; there is no resident-callable
 * window writer to bypass it.
 */
describe('colosseum state server store — the window start is gated by the four checks', () => {
  it('starts the window for an eligible resident', async () => {
    const started = await startColosseumWindow('profile-a');

    expect(started.progress.residentSince).not.toBeNull();
    expect(state.windows.get('profile-a')).not.toBeNull();
  });

  it('refuses to start the window when a check is not green, and records nothing', async () => {
    state.checks = [
      { id: 'identity', state: 'pending' },
      { id: 'funds', state: 'met' },
      { id: 'review', state: 'met' },
      { id: 'service-fee', state: 'met' },
    ];

    await expect(startColosseumWindow('profile-a')).rejects.toBeInstanceOf(
      ColosseumWindowNotEligibleError,
    );
    // No window was recorded, and the read shows none.
    expect(state.windows.has('profile-a')).toBe(false);
    expect((await loadColosseumState('profile-a')).progress.residentSince).toBeNull();
  });

  it('refuses when the checks are missing entirely (fail-closed)', async () => {
    state.checks = [];

    await expect(startColosseumWindow('profile-a')).rejects.toBeInstanceOf(
      ColosseumWindowNotEligibleError,
    );
    expect(state.windows.has('profile-a')).toBe(false);
  });

  it('cannot be pre-satisfied: an ineligible resident leaves the mint’s gate closed', async () => {
    // The resident calls the start while not eligible.
    state.checks = [
      { id: 'identity', state: 'met' },
      { id: 'funds', state: 'blocked' },
      { id: 'review', state: 'met' },
      { id: 'service-fee', state: 'met' },
    ];
    await expect(startColosseumWindow('profile-a')).rejects.toBeInstanceOf(
      ColosseumWindowNotEligibleError,
    );

    // The mint reads the same `applications.colosseum_resident_since` column. A
    // null window is never treated as elapsed, so the Citizen claim cannot pass
    // the 2-minute gate early.
    const since = (await loadColosseumState('profile-a')).progress.residentSince;
    expect(since).toBeNull();
    expect(complianceWindowElapsed(since, Date.now())).toBeNull();
  });
});
