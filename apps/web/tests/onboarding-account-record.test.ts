import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `deriveAndRecordAccount` must persist through the SECURITY DEFINER writer,
 * never a direct table insert.
 *
 * `authenticated` has no column privilege on `safe_deployments.safe_address`, so
 * the direct insert this action used to issue was refused on a fresh database:
 * the action swallowed the error, returned `status: 'failed'`, and no row was
 * ever written. These tests pin the contract that fixes it:
 *
 *   1. the write is `rpc('record_safe_sdk_address', …)`, not `.insert(...)`;
 *   2. the arguments are exactly the SDK-reported fields (profile_id is resolved
 *      server-side by the function, so the client never sends it);
 *   3. a write failure is surfaced honestly (`failed` + `console.warn`), not
 *      reported as a success;
 *   4. an existing row is re-derived and, when it still matches, is
 *      `already-recorded` with no second write (idempotent);
 *   5. an existing row that no longer matches the derivation is refreshed as a
 *      **new** row (`refreshed`), never updated in place.
 */

const hoisted = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  loadPasskeyCredential: vi.fn(),
  parseP256PublicKey: vi.fn(),
  toPasskeySigner: vi.fn(),
  deriveAccountFromPasskey: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
  createSupabaseServerClient: hoisted.createSupabaseServerClient,
}));
vi.mock('@/app/account/passkey-actions', () => ({
  loadPasskeyCredential: hoisted.loadPasskeyCredential,
}));
vi.mock('@/lib/passkey/public-key', () => ({
  parseP256PublicKey: hoisted.parseP256PublicKey,
}));
vi.mock('@/lib/safe/passkey-signer', () => ({
  toPasskeySigner: hoisted.toPasskeySigner,
}));
vi.mock('@/lib/safe/derive-account', () => ({
  deriveAccountFromPasskey: hoisted.deriveAccountFromPasskey,
}));

import { deriveAndRecordAccount } from '@/app/onboarding/account-actions';

const USER = 'user-1';
const SAFE = '0x1111111111111111111111111111111111111111';
const SEPOLIA = 11155111;

interface RecordedCall {
  readonly fn: string;
  readonly args: unknown;
}

interface FakeClient {
  readonly client: SupabaseClient;
  readonly rpc: RecordedCall[];
  readonly from: string[];
  readonly inserts: number;
}

function makeClient(options: {
  readonly existing?: { data: unknown; error: { message: string } | null };
  readonly rpc?: { data: unknown; error: { message: string } | null };
}): FakeClient {
  const rpc: RecordedCall[] = [];
  const from: string[] = [];
  let inserts = 0;

  const readBuilder: Record<string, unknown> = {};
  readBuilder.select = () => readBuilder;
  readBuilder.eq = () => readBuilder;
  readBuilder.order = () => readBuilder;
  readBuilder.limit = () => readBuilder;
  readBuilder.maybeSingle = async () =>
    options.existing ?? { data: null, error: null };
  readBuilder.insert = () => {
    inserts += 1;
    return Promise.resolve({ data: null, error: null });
  };

  const client = {
    from(table: string) {
      from.push(table);
      return readBuilder;
    },
    rpc(fn: string, args: unknown) {
      rpc.push({ fn, args });
      return Promise.resolve(options.rpc ?? { data: null, error: null });
    },
  };

  return { client: client as unknown as SupabaseClient, rpc, from, inserts };
}

function seedHappyPath(): void {
  hoisted.getSessionUser.mockResolvedValue({
    domain: 'application-session',
    provider: 'email',
    userId: USER,
    email: 'resident@example.com',
  });
  hoisted.loadPasskeyCredential.mockResolvedValue({
    credentialId: 'cred-1',
    publicKey: 'pk-1',
    signerAddress: null,
    transports: ['internal'],
    userVerification: true,
    createdAt: '2026-01-02T03:04:05.000Z',
    lastUsedAt: null,
  });
  hoisted.parseP256PublicKey.mockReturnValue({ x: 1n, y: 2n });
  hoisted.toPasskeySigner.mockReturnValue({ rawId: 'cred-1' });
  hoisted.deriveAccountFromPasskey.mockResolvedValue({
    safeAddress: SAFE,
    deployed: false,
    chainId: SEPOLIA,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  seedHappyPath();
});

describe('deriveAndRecordAccount record path', () => {
  it('writes through record_safe_sdk_address and never inserts directly', async () => {
    const fake = makeClient({});
    hoisted.createSupabaseServerClient.mockResolvedValue(fake.client);

    const outcome = await deriveAndRecordAccount();

    expect(outcome).toEqual({
      status: 'recorded',
      safeAddress: SAFE,
      deployed: false,
    });
    expect(fake.rpc).toEqual([
      {
        fn: 'record_safe_sdk_address',
        args: {
          p_safe_address: SAFE,
          p_deployment_chain_id: SEPOLIA,
          p_status: 'predicted',
        },
      },
    ]);
    // The read is a table select; the write is not. No direct insert is issued.
    expect(fake.from).toContain('safe_deployments');
    expect(fake.inserts).toBe(0);
  });

  it('records the SDK deployment reading as the status', async () => {
    hoisted.deriveAccountFromPasskey.mockResolvedValue({
      safeAddress: SAFE,
      deployed: true,
      chainId: SEPOLIA,
    });
    const fake = makeClient({});
    hoisted.createSupabaseServerClient.mockResolvedValue(fake.client);

    const outcome = await deriveAndRecordAccount();

    expect(outcome.status).toBe('recorded');
    expect(outcome.deployed).toBe(true);
    expect(fake.rpc[0]?.args).toMatchObject({ p_status: 'deployed' });
  });

  it('surfaces a failed write honestly instead of reporting success', async () => {
    const fake = makeClient({
      rpc: { data: null, error: { message: 'permission denied for column' } },
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(fake.client);

    const outcome = await deriveAndRecordAccount();

    expect(outcome).toEqual({
      status: 'failed',
      safeAddress: SAFE,
      deployed: false,
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('recording the account address failed'),
      expect.stringContaining('permission denied for column'),
    );
  });

  it('re-derives and does not write when the existing row still matches', async () => {
    const fake = makeClient({
      existing: {
        data: { safe_address: SAFE, status: 'predicted' },
        error: null,
      },
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(fake.client);

    const outcome = await deriveAndRecordAccount();

    expect(outcome).toEqual({
      status: 'already-recorded',
      safeAddress: SAFE,
      deployed: false,
    });
    // Idempotent: the row matches the fresh derivation, so nothing is written.
    expect(fake.rpc).toHaveLength(0);
    expect(fake.inserts).toBe(0);
    expect(hoisted.deriveAccountFromPasskey).toHaveBeenCalledTimes(1);
  });

  it('refreshes a stale row as a new row and reports the previous address', async () => {
    const STALE = '0x2222222222222222222222222222222222222222';
    const fake = makeClient({
      existing: {
        data: { safe_address: STALE, status: 'predicted' },
        error: null,
      },
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(fake.client);

    const outcome = await deriveAndRecordAccount();

    // The new address is written; the old row is never updated in place.
    expect(outcome).toEqual({
      status: 'refreshed',
      safeAddress: SAFE,
      deployed: false,
      previousAddress: STALE,
    });
    expect(fake.rpc).toEqual([
      {
        fn: 'record_safe_sdk_address',
        args: {
          p_safe_address: SAFE,
          p_deployment_chain_id: SEPOLIA,
          p_status: 'predicted',
        },
      },
    ]);
    expect(fake.inserts).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Safe address changed'),
      { from: STALE, to: SAFE },
    );
  });

  it('keeps an existing row when the re-derivation fails', async () => {
    const fake = makeClient({
      existing: {
        data: { safe_address: SAFE, status: 'predicted' },
        error: null,
      },
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(fake.client);
    hoisted.deriveAccountFromPasskey.mockRejectedValue(
      new Error('SEPOLIA_RPC_URL is not set, so the bundler cannot be reached.'),
    );

    const outcome = await deriveAndRecordAccount();

    // An RPC outage must not take a recorded account away.
    expect(outcome).toEqual({
      status: 'already-recorded',
      safeAddress: SAFE,
      deployed: false,
    });
    expect(fake.rpc).toHaveLength(0);
  });
});
