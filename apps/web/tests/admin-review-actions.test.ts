import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The Admin review write path (D19).
 *
 * `submitReview` is the only write the console performs. These tests pin the
 * two invariants the contract depends on:
 *   - a non-reviewer is refused and nothing is written;
 *   - a reviewer's action appends a `review_events` row and never UPDATEs
 *     `applications.status` directly — the trigger owns that column.
 *
 * The on-chain `kade.review.v1` write is gated, so a successful review is
 * recorded with `attestation_uid` NULL rather than a fabricated UID.
 */

const hoisted = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: hoisted.createSupabaseServerClient,
}));

vi.mock('next/cache', () => ({ revalidatePath: hoisted.revalidatePath }));

import { submitReview } from '@/app/admin/review-actions';
import { NotAReviewerError } from '@/lib/review/errors';

interface Call {
  readonly table: string;
  op: 'select' | 'insert' | 'update' | null;
  payload: Record<string, unknown> | null;
}

interface FakeOptions {
  readonly user?: { id: string } | null;
  readonly reviewer?: { id: string; role: string } | null;
  readonly application?: { id: string; ref: string | null } | null;
  readonly insertError?: { message: string } | null;
}

function createFakeClient(options: FakeOptions = {}): {
  readonly client: SupabaseClient;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  const client = {
    auth: {
      async getUser() {
        const user =
          options.user === undefined ? { id: 'reviewer-1' } : options.user;
        return { data: { user }, error: null };
      },
    },
    from(table: string) {
      const call: Call = { table, op: null, payload: null };
      calls.push(call);
      const builder = {
        select() {
          if (call.op === null) call.op = 'select';
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          call.op = 'insert';
          call.payload = payload;
          return builder;
        },
        update(payload: Record<string, unknown>) {
          call.op = 'update';
          call.payload = payload;
          return builder;
        },
        eq() {
          return builder;
        },
        async maybeSingle() {
          if (table === 'reviewers') {
            return {
              data:
                options.reviewer === undefined
                  ? { id: 'reviewer-1', role: 'reviewer' }
                  : options.reviewer,
              error: null,
            };
          }
          if (table === 'applications') {
            return {
              data:
                options.application === undefined
                  ? { id: 'app-1', ref: 'CW-2026-0409' }
                  : options.application,
              error: null,
            };
          }
          return { data: null, error: null };
        },
        async single() {
          if (options.insertError) {
            return { data: null, error: options.insertError };
          }
          return { data: { id: 42 }, error: null };
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const APPLICATION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('submitReview', () => {
  it('refuses a non-reviewer and writes nothing', async () => {
    const { client, calls } = createFakeClient({ reviewer: null });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(
      submitReview({ applicationId: APPLICATION_ID, action: 'approve' }),
    ).rejects.toBeInstanceOf(NotAReviewerError);

    expect(calls.some((call) => call.table === 'review_events')).toBe(false);
  });

  it('refuses without a signed-in session', async () => {
    const { client, calls } = createFakeClient({ user: null });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(
      submitReview({ applicationId: APPLICATION_ID, action: 'approve' }),
    ).rejects.toThrow(/signed-in session/i);

    expect(calls).toHaveLength(0);
  });

  it('rejects an unknown action before touching the database', async () => {
    const { client, calls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(
      submitReview({
        applicationId: APPLICATION_ID,
        action: 'delete' as never,
      }),
    ).rejects.toThrow(/approve, block or reopen/i);

    expect(calls).toHaveLength(0);
  });

  it('appends a review_events row for the reviewer and never updates status', async () => {
    const { client, calls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const result = await submitReview({
      applicationId: APPLICATION_ID,
      action: 'approve',
      note: 'Looks good',
    });

    const insert = calls.find(
      (call) => call.table === 'review_events' && call.op === 'insert',
    );
    expect(insert?.payload).toEqual({
      application_id: APPLICATION_ID,
      reviewer_id: 'reviewer-1',
      action: 'approve',
      note: 'Looks good',
      attestation_uid: null,
    });

    // The status flip belongs to the trigger; a direct UPDATE must never happen.
    expect(
      calls.some(
        (call) => call.table === 'applications' && call.op === 'update',
      ),
    ).toBe(false);

    // The chain write is gated: no UID is invented.
    expect(result.attestation).toBe('blocked');
    expect(result.attestationUid).toBeNull();
    expect(result.reviewEventId).toBe(42);
  });

  it('surfaces an insert failure instead of reporting success', async () => {
    const { client } = createFakeClient({
      insertError: { message: 'permission denied' },
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(
      submitReview({ applicationId: APPLICATION_ID, action: 'block' }),
    ).rejects.toThrow(/permission denied/);
  });
});
