import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shared `(resident)/layout.tsx` reads the shell state, and a page that also
 * needs the Safe address or the review state reads it again. Both loaders are
 * wrapped in React's per-request `cache()`, so the two call sites collapse into
 * **one** read per request — while two different requests still each pay their
 * own read (the cache is request-scoped, never a global memo).
 *
 * These tests drive the **real** React cache implementation. The app's vitest
 * environment resolves `react` to the client build, whose `cache` is a no-op;
 * production server components resolve the `react-server` build, whose `cache`
 * reads a dispatcher off React's server internals. So `react` is mocked here to
 * the react-server build, and a request-scoped dispatcher is installed around
 * each call — the same mechanism the Next server uses.
 *
 * The negative controls are explicit: the same profile in two requests reads
 * twice, two profiles in one request read twice, and with no dispatcher (the
 * cache inactive) the read happens every time. A test that only counted a single
 * read would also pass if the loader were never called twice, so the call counts
 * are asserted against a real store/supabase seam.
 */

const hoisted = vi.hoisted(() => ({
  getForProfile: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/safe/manifest', () => ({
  safeDeploymentStore: () => ({ getForProfile: hoisted.getForProfile }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ from: hoisted.from }),
}));

vi.mock('react', async () => {
  // The react-server build ships without type declarations; the mock only needs
  // its runtime exports (notably the real `cache`).
  // @ts-expect-error - no declaration file for the internal react-server entry.
  const serverReact = await import('../../../node_modules/react/react.react-server.js');
  return {
    ...(serverReact as object),
    default:
      (serverReact as { default?: unknown }).default ?? serverReact,
  };
});

import * as React from 'react';
import { loadReviewBar } from '@/lib/review/review-bar';
import { loadShellSafe } from '@/lib/safe/shell';

interface ReactServerInternals {
  A: unknown;
}

/**
 * React's server internals, which carry the per-request cache dispatcher `A`.
 * The react-server build exposes them under this deliberately-scary name.
 */
const internals = (
  React as unknown as {
    __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactServerInternals;
  }
).__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

/**
 * Install a fresh request-scoped cache store, as the RSC renderer does once per
 * request. Every call while it is installed shares the store; a new request gets
 * a new store, so nothing survives from one request to the next.
 */
function beginRequest(): void {
  const store = new Map<unknown, unknown>();
  internals.A = {
    getCacheForType: () => store,
    cacheSignal: () => null,
  };
}

function endRequest(): void {
  internals.A = null;
}

/** A fake applications/reviewers result, so the review read is observable. */
function seedReview(): void {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  hoisted.from.mockReturnValue(builder);
}

beforeEach(() => {
  hoisted.getForProfile.mockReset();
  hoisted.getForProfile.mockResolvedValue(null);
  hoisted.from.mockReset();
  seedReview();
  beginRequest();
});

afterEach(() => {
  endRequest();
});

describe('loadShellSafe is deduped per request', () => {
  it('reads the deployment record once for two calls in one request', async () => {
    await loadShellSafe('user-1');
    await loadShellSafe('user-1');

    // The layout and the page share this read; before the wrapper this was 2.
    expect(hoisted.getForProfile).toHaveBeenCalledTimes(1);
  });

  it('does not dedupe two different profiles in one request', async () => {
    await loadShellSafe('user-1');
    await loadShellSafe('user-2');

    // The cache is keyed by the argument, so it cannot serve one resident's
    // Safe for another.
    expect(hoisted.getForProfile).toHaveBeenCalledTimes(2);
    expect(hoisted.getForProfile).toHaveBeenNthCalledWith(1, 'user-1');
    expect(hoisted.getForProfile).toHaveBeenNthCalledWith(2, 'user-2');
  });

  it('does not carry a cached read into the next request', async () => {
    await loadShellSafe('user-1');
    endRequest();
    beginRequest();
    await loadShellSafe('user-1');

    // Per-request, never global: the second request reads for itself.
    expect(hoisted.getForProfile).toHaveBeenCalledTimes(2);
  });

  it('reads every time when there is no request dispatcher (cache inactive)', async () => {
    endRequest();
    await loadShellSafe('user-1');
    await loadShellSafe('user-1');

    // The negative control for the wrapper: outside a React request the cache
    // is a passthrough, exactly the old behaviour. This is what the wrapped
    // loader avoids within a real request.
    expect(hoisted.getForProfile).toHaveBeenCalledTimes(2);
  });
});

describe('loadReviewBar is deduped per request', () => {
  it('reads the applications and reviewers rows once for two calls in one request', async () => {
    await loadReviewBar('user-1');
    await loadReviewBar('user-1');

    // One read is two table queries (applications + reviewers); two reads would
    // be four. The layout and the withdraw route share the one read.
    expect(hoisted.from).toHaveBeenCalledTimes(2);
  });

  it('reads again in the next request', async () => {
    await loadReviewBar('user-1');
    endRequest();
    beginRequest();
    await loadReviewBar('user-1');

    expect(hoisted.from).toHaveBeenCalledTimes(4);
  });
});
