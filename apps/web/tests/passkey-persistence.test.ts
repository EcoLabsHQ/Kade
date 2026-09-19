import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { savePasskeyCredential } from '@/app/account/passkey-actions';
import {
  createDatabasePasskeyStore,
  type PasskeyCredentialWrite,
} from '@/lib/passkey/store';
import type { SavePasskeyCredentialInput } from '@/lib/passkey/credential';

/**
 * Passkey credential persistence tests.
 *
 * There is no reachable Supabase in this repository's test environment, so the
 * write path is exercised against a recording fake and the derivation is
 * mocked. The assertions are about the contract:
 *
 *   - only the columns the `authenticated` role is granted are inserted, and
 *     never `signer_address`;
 *   - the profile row is created before the credential's foreign key needs it;
 *   - the derived signer is written only through the service client, and its
 *     absence is reported rather than faked;
 *   - the signer comes from the public key, never from the caller's input.
 */

const hoisted = vi.hoisted(() => ({
  deriveAccount: vi.fn(),
  parseP256PublicKey: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  isServiceRoleConfigured: vi.fn(),
}));

vi.mock('@/app/onboarding/signer-actions', () => ({
  deriveAccount: hoisted.deriveAccount,
}));

vi.mock('@/lib/passkey/public-key', () => ({
  parseP256PublicKey: hoisted.parseP256PublicKey,
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: hoisted.createSupabaseServerClient,
  createSupabaseServiceClient: hoisted.createSupabaseServiceClient,
  isServiceRoleConfigured: hoisted.isServiceRoleConfigured,
}));

vi.mock('@/lib/env', () => ({
  isAuthConfigured: () => true,
  readAuthEnv: () => ({
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon-key',
    siteUrl: 'http://localhost:3000',
    callbackPath: '/auth/callback',
  }),
}));

/* -------------------------------------------------------------------------- */
/* Fake Supabase client                                                       */
/* -------------------------------------------------------------------------- */

interface RecordedCall {
  readonly table: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

interface FakeOptions {
  readonly credentialRow?: Record<string, unknown> | null;
  readonly user?: { id: string } | null;
}

class FakeQuery {
  private selected = false;

  constructor(
    private readonly table: string,
    private readonly ops: RecordedCall[],
    private readonly options: FakeOptions,
  ) {}

  select(...args: unknown[]): this {
    this.selected = true;
    this.record('select', args);
    return this;
  }

  insert(...args: unknown[]): this {
    this.record('insert', args);
    return this;
  }

  upsert(...args: unknown[]): this {
    this.record('upsert', args);
    return this;
  }

  update(...args: unknown[]): this {
    this.record('update', args);
    return this;
  }

  eq(...args: unknown[]): this {
    this.record('eq', args);
    return this;
  }

  maybeSingle(): this {
    this.record('maybeSingle', []);
    return this;
  }

  private record(method: string, args: readonly unknown[]): void {
    this.ops.push({ table: this.table, method, args });
  }

  then(
    resolve: (value: { data: unknown; error: null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown> {
    return Promise.resolve({ data: this.data(), error: null }).then(
      resolve,
      reject,
    );
  }

  private data(): unknown {
    if (this.table === 'passkey_credentials' && this.selected) {
      return this.options.credentialRow ?? null;
    }
    return null;
  }
}

function createFakeSupabase(options: FakeOptions = {}): {
  readonly client: SupabaseClient;
  readonly ops: RecordedCall[];
} {
  const ops: RecordedCall[] = [];
  const client = {
    from(table: string) {
      return new FakeQuery(table, ops, options);
    },
    auth: {
      async getUser() {
        const user =
          options.user === undefined ? { id: 'user-1' } : options.user;
        return { data: { user }, error: null };
      },
    },
  };
  return { client: client as unknown as SupabaseClient, ops };
}

const DERIVED_SIGNER = '0x00000000000000000000000000000000000000AA';
const STORED_ROW = {
  credential_id: 'cred-1',
  public_key: 'pk-1',
  signer_address: DERIVED_SIGNER,
  transports: ['internal'],
  user_verification: true,
  created_at: '2026-01-02T03:04:05.000Z',
  last_used_at: null,
};

const WRITE: PasskeyCredentialWrite = {
  credentialId: 'cred-1',
  publicKey: 'pk-1',
  signerAddress: null,
  transports: ['internal'],
  userVerification: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.isServiceRoleConfigured.mockReturnValue(true);
  hoisted.parseP256PublicKey.mockReturnValue({ x: 11n, y: 22n });
  hoisted.deriveAccount.mockResolvedValue({
    signerAddress: DERIVED_SIGNER,
    safeAddress: '0x00000000000000000000000000000000000000BB',
  });
});

/* -------------------------------------------------------------------------- */
/* Database store                                                             */
/* -------------------------------------------------------------------------- */

describe('database passkey store', () => {
  it('writes only the resident-granted columns, never signer_address', async () => {
    const { client, ops } = createFakeSupabase();
    const store = createDatabasePasskeyStore({
      getClient: async () => client,
      getServiceClient: async () => null,
    });

    await store.save('user-1', WRITE);

    const insert = ops.find(
      (op) => op.table === 'passkey_credentials' && op.method === 'insert',
    );
    expect(insert?.args[0]).toEqual({
      profile_id: 'user-1',
      credential_id: 'cred-1',
      public_key: 'pk-1',
      transports: ['internal'],
      user_verification: true,
    });
    expect(insert?.args[0]).not.toHaveProperty('signer_address');
  });

  it('creates the profile row before inserting the credential', async () => {
    const { client, ops } = createFakeSupabase();
    const store = createDatabasePasskeyStore({
      getClient: async () => client,
      getServiceClient: async () => null,
    });

    await store.save('user-1', WRITE);

    const profileIndex = ops.findIndex(
      (op) => op.table === 'profiles' && op.method === 'upsert',
    );
    const credentialIndex = ops.findIndex(
      (op) => op.table === 'passkey_credentials' && op.method === 'insert',
    );
    expect(profileIndex).toBeGreaterThanOrEqual(0);
    expect(ops[profileIndex]?.args).toEqual([
      { id: 'user-1' },
      { onConflict: 'id', ignoreDuplicates: true },
    ]);
    expect(profileIndex).toBeLessThan(credentialIndex);
  });

  it('leaves the signer NULL and reports it when no service client is configured', async () => {
    const { client, ops } = createFakeSupabase();
    const store = createDatabasePasskeyStore({
      getClient: async () => client,
      getServiceClient: async () => null,
    });

    const outcome = await store.save('user-1', {
      ...WRITE,
      signerAddress: DERIVED_SIGNER,
    });

    expect(outcome.signerAddressPersisted).toBe(false);
    expect(ops.some((op) => op.method === 'update')).toBe(false);
  });

  it('writes the derived signer through the service client, scoped to the owner', async () => {
    const { client, ops } = createFakeSupabase();
    const { client: serviceClient, ops: serviceOps } = createFakeSupabase();
    const store = createDatabasePasskeyStore({
      getClient: async () => client,
      getServiceClient: async () => serviceClient,
    });

    const outcome = await store.save('user-1', {
      ...WRITE,
      signerAddress: DERIVED_SIGNER,
    });

    expect(outcome.signerAddressPersisted).toBe(true);
    const update = serviceOps.find(
      (op) => op.table === 'passkey_credentials' && op.method === 'update',
    );
    expect(update?.args[0]).toEqual({ signer_address: DERIVED_SIGNER });
    const eqs = serviceOps
      .filter((op) => op.method === 'eq')
      .map((op) => op.args);
    expect(eqs).toContainEqual(['profile_id', 'user-1']);
    expect(eqs).toContainEqual(['credential_id', 'cred-1']);
    // The credential insert itself stays on the resident-scoped client.
    expect(
      ops.some(
        (op) => op.table === 'passkey_credentials' && op.method === 'insert',
      ),
    ).toBe(true);
  });

  it('loads the stored credential', async () => {
    const { client } = createFakeSupabase({ credentialRow: STORED_ROW });
    const store = createDatabasePasskeyStore({
      getClient: async () => client,
    });

    expect(await store.getByUser('user-1')).toEqual({
      credentialId: 'cred-1',
      publicKey: 'pk-1',
      signerAddress: DERIVED_SIGNER,
      transports: ['internal'],
      userVerification: true,
      createdAt: '2026-01-02T03:04:05.000Z',
      lastUsedAt: null,
    });
  });

  it('returns null when the resident has no stored credential', async () => {
    const { client } = createFakeSupabase({ credentialRow: null });
    const store = createDatabasePasskeyStore({
      getClient: async () => client,
    });

    expect(await store.getByUser('user-1')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Server action                                                              */
/* -------------------------------------------------------------------------- */

const ACTION_INPUT: SavePasskeyCredentialInput = {
  credentialId: 'cred-1',
  publicKey: 'pk-1',
  transports: ['internal'],
  userVerification: true,
};

describe('savePasskeyCredential', () => {
  it('derives the signer from the public key and ignores a client-supplied address', async () => {
    const session = createFakeSupabase({ credentialRow: STORED_ROW });
    const service = createFakeSupabase();
    hoisted.createSupabaseServerClient.mockResolvedValue(session.client);
    hoisted.createSupabaseServiceClient.mockResolvedValue(service.client);

    // A hostile caller smuggle a signer address; it must be ignored.
    const tampered = {
      ...ACTION_INPUT,
      signerAddress: '0x00000000000000000000000000000000000000FF',
    } as unknown as SavePasskeyCredentialInput;

    const result = await savePasskeyCredential(tampered);

    expect(hoisted.parseP256PublicKey).toHaveBeenCalledWith('pk-1');
    expect(hoisted.deriveAccount).toHaveBeenCalledWith('11', '22', 'user-1');

    const update = service.ops.find((op) => op.method === 'update');
    expect(update?.args[0]).toEqual({ signer_address: DERIVED_SIGNER });
    expect(JSON.stringify(service.ops)).not.toContain(
      '0x00000000000000000000000000000000000000FF',
    );

    expect(session.ops.some((op) => op.method === 'update')).toBe(false);
    expect(result.credential.signerAddress).toBe(DERIVED_SIGNER);
    expect(result.signer).toEqual({
      status: 'persisted',
      address: DERIVED_SIGNER,
    });
  });

  it('saves without the signer and reports the missing capability when no service key is configured', async () => {
    hoisted.isServiceRoleConfigured.mockReturnValue(false);
    const session = createFakeSupabase({
      credentialRow: { ...STORED_ROW, signer_address: null },
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(session.client);

    const result = await savePasskeyCredential(ACTION_INPUT);

    expect(hoisted.deriveAccount).not.toHaveBeenCalled();
    expect(hoisted.createSupabaseServiceClient).not.toHaveBeenCalled();

    // The resident's own columns are still written.
    expect(
      session.ops.some(
        (op) => op.table === 'passkey_credentials' && op.method === 'insert',
      ),
    ).toBe(true);
    expect(session.ops.some((op) => op.method === 'update')).toBe(false);

    expect(result.credential.signerAddress).toBeNull();
    expect(result.signer.status).toBe('not-persisted');
    if (result.signer.status === 'not-persisted') {
      expect(result.signer.reason).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    }
  });

  it('refuses a credential that did not require user verification', async () => {
    await expect(
      savePasskeyCredential({ ...ACTION_INPUT, userVerification: false }),
    ).rejects.toThrow(/user verification/i);
    expect(hoisted.createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('refuses to save without a signed-in session', async () => {
    const session = createFakeSupabase({ user: null });
    hoisted.createSupabaseServerClient.mockResolvedValue(session.client);

    await expect(savePasskeyCredential(ACTION_INPUT)).rejects.toThrow(
      /signed-in session/i,
    );
  });
});
