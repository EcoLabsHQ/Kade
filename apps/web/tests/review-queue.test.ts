import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadReviewQueue } from '@/lib/review/queue';

/**
 * The Admin queue loader (D19, contract v1.7).
 *
 * The identity outcome must come from `self_verifications`, the real source of
 * truth, and never from `identity_attestations` (which the identity path no
 * longer writes). Reading the wrong table would show a verified resident as
 * unverified on the surface a reviewer decides on.
 */

interface Tables {
  readonly [table: string]: readonly Record<string, unknown>[];
}

function createFakeClient(tables: Tables): {
  readonly client: SupabaseClient;
  readonly queried: string[];
} {
  const queried: string[] = [];
  const client = {
    from(table: string) {
      queried.push(table);
      const data = tables[table] ?? [];
      const builder = {
        select: () => builder,
        in: () => builder,
        order: () => builder,
        maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
        then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data, error: null }).then(resolve),
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, queried };
}

const APPLICATION = {
  id: 'app-1',
  ref: 'CW-2026-0409',
  tier: '3-year',
  status: 'pre_approved',
  preapproval_usdc: 1.75,
  service_usdc: null,
  fee_tx: null,
  review_uid: null,
  service_uid: null,
  profile_id: 'p1',
  profiles: { id: 'p1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@x' },
};

const VERIFICATION = {
  profile_id: 'p1',
  provider: 'self',
  status: 'valid',
  verified_at: '2026-01-01T00:00:00.000Z',
  self_nullifier: 'nullifier-1',
};

describe('loadReviewQueue identity source', () => {
  it('reads the Self verification outcome, not identity_attestations', async () => {
    const { client, queried } = createFakeClient({
      applications: [APPLICATION],
      self_verifications: [VERIFICATION],
    });

    const [item] = await loadReviewQueue(client);

    expect(queried).toContain('self_verifications');
    expect(queried).not.toContain('identity_attestations');
    expect(item?.identity).toEqual({
      provider: 'self',
      status: 'valid',
      verifiedAt: '2026-01-01T00:00:00.000Z',
      selfNullifier: 'nullifier-1',
    });
    // It must not carry a nationality or an expiry: Kade stores neither.
    expect(item?.identity).not.toHaveProperty('nationality');
    expect(item?.identity).not.toHaveProperty('expiresAt');
    expect(item?.identity).not.toHaveProperty('attestationUid');
  });

  it('maps an invalid outcome as invalid, never as verified', async () => {
    const { client } = createFakeClient({
      applications: [APPLICATION],
      self_verifications: [
        { ...VERIFICATION, status: 'invalid', verified_at: null, self_nullifier: null },
      ],
    });

    const [item] = await loadReviewQueue(client);
    expect(item?.identity).toMatchObject({ status: 'invalid' });
  });

  it('reports no identity when the resident has no Self row', async () => {
    const { client } = createFakeClient({ applications: [APPLICATION] });
    const [item] = await loadReviewQueue(client);
    expect(item?.identity).toBeNull();
  });

  it('drops a Self row whose status is not a completed outcome', async () => {
    const { client } = createFakeClient({
      applications: [APPLICATION],
      self_verifications: [{ ...VERIFICATION, status: 'pending' }],
    });
    const [item] = await loadReviewQueue(client);
    expect(item?.identity).toBeNull();
  });
});
