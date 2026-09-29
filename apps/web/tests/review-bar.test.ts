import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `loadReviewBar` is the shell's single source of review state.
 *
 * The banner's `show` and the sidebar notice's `reviewed` must come from the
 * same applications row, so they can never be read independently and disagree.
 * This file pins that derivation against a fake Supabase client — offline, no
 * network — for the four states the row can express and the unreadable case.
 */

const hoisted = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ from: hoisted.from }),
}));

import { loadReviewBar } from '@/lib/review/review-bar';

type Result = { data: unknown; error: { message: string } | null };

function chain(result: Result) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(result),
  };
  return builder;
}

function seed(app: Result, reviewer: Result = { data: null, error: null }) {
  hoisted.from.mockImplementation((table: string) =>
    chain(table === 'applications' ? app : reviewer),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadReviewBar', () => {
  it('marks an approved application as reviewed and not shown', async () => {
    seed({ data: { ref: 'CW-2026-0409', status: 'approved' }, error: null });

    await expect(loadReviewBar('user-1')).resolves.toEqual({
      show: false,
      reference: 'CW-2026-0409',
      reviewed: true,
      isReviewer: false,
    });
  });

  it('shows an application still awaiting review, and does not call it reviewed', async () => {
    seed({ data: { ref: 'CW-2026-0409', status: 'pre_approved' }, error: null });

    await expect(loadReviewBar('user-1')).resolves.toEqual({
      show: true,
      reference: 'CW-2026-0409',
      reviewed: false,
      isReviewer: false,
    });
  });

  it('keeps a blocked application in review, never cleared', async () => {
    seed({ data: { ref: 'CW-2026-0409', status: 'blocked' }, error: null });

    const state = await loadReviewBar('user-1');
    expect(state.show).toBe(true);
    expect(state.reviewed).toBe(false);
  });

  it('shows neither notice when there is no application', async () => {
    seed({ data: null, error: null });

    await expect(loadReviewBar('user-1')).resolves.toEqual({
      show: false,
      reference: null,
      reviewed: false,
      isReviewer: false,
    });
  });

  it('reads the reviewer flag from its own row without changing the notice', async () => {
    seed(
      { data: { ref: null, status: 'submitted' }, error: null },
      { data: { id: 'user-1' }, error: null },
    );

    const state = await loadReviewBar('user-1');
    expect(state.isReviewer).toBe(true);
    expect(state.show).toBe(true);
    expect(state.reviewed).toBe(false);
  });

  it('degrades to no notice and no reviewer when the read fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    seed({ data: null, error: { message: 'database down' } });

    await expect(loadReviewBar('user-1')).resolves.toEqual({
      show: false,
      reference: null,
      reviewed: false,
      isReviewer: false,
    });
  });
});
