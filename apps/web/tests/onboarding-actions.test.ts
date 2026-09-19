import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OnboardingSnapshot } from '@/lib/onboarding/persistence';

/**
 * The live Step 2 write path.
 *
 * `saveOnboardingStep2` is what the wizard actually calls. This is the write
 * boundary the old `createSupabaseOnboardingStore.save` fake never touched, so
 * the client-supplied-fee contract is pinned here instead of on the removed
 * seam: the RPC payload is built from the snapshot, which has no fee field, and
 * `preapproval_usdc` never appears on it.
 */

const hoisted = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: hoisted.createSupabaseServerClient,
}));

vi.mock('next/cache', () => ({ revalidatePath: hoisted.revalidatePath }));

vi.mock('@/lib/env', () => ({
  isAuthConfigured: () => true,
  readAuthEnv: () => ({
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon-key',
    siteUrl: 'http://localhost:3000',
    callbackPath: '/auth/callback',
  }),
  readFeeMode: () => 'demo',
}));

import { saveOnboardingStep2 } from '@/app/onboarding/actions';

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function createFakeClient(options: {
  readonly user?: { id: string } | null;
  readonly rpcError?: { message: string } | null;
  readonly applicationId?: string;
  readonly fee?: number | null;
} = {}): { readonly client: SupabaseClient; readonly rpcCalls: RpcCall[] } {
  const rpcCalls: RpcCall[] = [];
  const client = {
    auth: {
      async getUser() {
        const user =
          options.user === undefined ? { id: 'user-1' } : options.user;
        return { data: { user }, error: null };
      },
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (options.rpcError) {
        return { data: null, error: options.rpcError };
      }
      return { data: options.applicationId ?? 'app-1', error: null };
    },
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: { preapproval_usdc: options.fee ?? 1.75 }, error: null };
        },
      };
    },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls };
}

const snapshot: OnboardingSnapshot = {
  profile: { firstName: 'Ada', lastName: 'Lovelace', dob: '1990-01-01' },
  citizenships: ['NL'],
  residences: [{ countryCode: 'NL', fromYear: 2000, toYear: 'present' }],
  tier: 2,
  members: [
    { name: 'Grace', relation: 'Daughter', dob: '2015-05-05', citizenship: 'DE' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveOnboardingStep2 (the live write path)', () => {
  it('sends no fee, amount or usdc key to the RPC', async () => {
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await saveOnboardingStep2(snapshot);

    expect(rpcCalls).toHaveLength(1);
    const call = rpcCalls[0];
    if (!call) throw new Error('the RPC was not called');
    expect(call.name).toBe('save_onboarding_step2');
    const payload = JSON.stringify(call.args);
    expect(payload).not.toMatch(/preapproval_usdc/);
    expect(payload).not.toMatch(/"amount"/);
    expect(payload).not.toMatch(/"usdc"/);
    expect(payload).not.toMatch(/"fee"/);
  });

  it('passes the tier as its database value and the residences as sent', async () => {
    const { client, rpcCalls } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await saveOnboardingStep2(snapshot);

    const call = rpcCalls[0];
    if (!call) throw new Error('the RPC was not called');
    expect(call.args.p_tier).toBe('indefinite');
    expect(call.args.p_residences).toEqual([
      { countryCode: 'NL', fromYear: 2000, toYear: 'present' },
    ]);
  });

  it('reads the database-recomputed fee back rather than computing it', async () => {
    const { client } = createFakeClient({ fee: 2.5 });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(saveOnboardingStep2(snapshot)).resolves.toEqual({
      applicationId: 'app-1',
      preapprovalUsdc: 2.5,
    });
  });

  it('refuses to save without a signed-in session', async () => {
    const { client, rpcCalls } = createFakeClient({ user: null });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(saveOnboardingStep2(snapshot)).rejects.toThrow(
      /signed-in session/i,
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it('surfaces an RPC error rather than reporting a successful save', async () => {
    const { client } = createFakeClient({
      rpcError: { message: 'permission denied' },
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(saveOnboardingStep2(snapshot)).rejects.toThrow(
      /permission denied/,
    );
  });
});
