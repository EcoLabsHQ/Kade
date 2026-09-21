import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACTIVE_SAFE_VERSION,
  DEPLOYED_SAFE_PROXY_CREATION_CODE_HASH,
  SAFE_DEPLOYMENTS,
} from '@kade/shared';
import {
  SafeDeploymentNotConfiguredError,
  SafeDeploymentNotPredictedError,
  SafeDeploymentWriteError,
  buildSafeDeploymentManifest,
  createSafeDeploymentStore,
  safeDeploymentStore,
  type SafePredictionInput,
} from '@/lib/safe/manifest';

/**
 * Safe deployment manifest persistence (D4).
 *
 * There is no reachable Supabase here, so the write path is exercised against
 * an in-memory fake that reproduces the one database behaviour idempotency
 * depends on: `ON CONFLICT (safe_address) DO NOTHING`. The assertions are about
 * the contract:
 *
 *   - a prediction is persisted complete, with every manifest input;
 *   - a repeat prediction is the same row, not a duplicate, and cannot move the
 *     recorded inputs;
 *   - a deployment outcome (success or failure) can only update an existing
 *     prediction, never create one;
 *   - reads and writes are scoped to the owning resident; the writes go through
 *     SECURITY DEFINER functions, so no service-role key is involved.
 */

/* -------------------------------------------------------------------------- */
/* In-memory Supabase fake                                                    */
/* -------------------------------------------------------------------------- */

interface Row {
  [key: string]: unknown;
}

interface RecordedCall {
  readonly table: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

const NOW = '2026-01-02T03:04:05.000Z';

class FakeBackend {
  private readonly tables = new Map<string, Row[]>();

  rows(table: string): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  seed(table: string, row: Row): void {
    this.rows(table).push(row);
  }
}

function withDefaults(table: string, payload: Row): Row {
  if (table === 'safe_deployments') {
    return {
      predicted_at: NOW,
      queued_at: null,
      deployed_at: null,
      failed_at: null,
      updated_at: NOW,
      failure_reason: null,
      ...payload,
    };
  }
  return { ...payload };
}

class FakeQuery {
  private readonly filters: Array<readonly [string, unknown]> = [];
  private op: 'select' | 'upsert' | 'update' | null = null;
  private payload: Row | null = null;
  private conflict: string[] = [];
  private ignoreDuplicates = false;
  private single = false;
  private orderSpec: { column: string; ascending: boolean } | null = null;
  private limitN: number | null = null;

  constructor(
    private readonly table: string,
    private readonly backend: FakeBackend,
    private readonly ops: RecordedCall[],
  ) {}

  select(...args: unknown[]): this {
    this.ops.push({ table: this.table, method: 'select', args });
    if (this.op === null) this.op = 'select';
    return this;
  }

  upsert(
    values: Row,
    options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ): this {
    this.ops.push({ table: this.table, method: 'upsert', args: [values, options] });
    this.op = 'upsert';
    this.payload = values;
    this.conflict = options?.onConflict
      ? options.onConflict.split(',').map((column) => column.trim())
      : [];
    this.ignoreDuplicates = options?.ignoreDuplicates ?? false;
    return this;
  }

  update(values: Row): this {
    this.ops.push({ table: this.table, method: 'update', args: [values] });
    this.op = 'update';
    this.payload = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.ops.push({ table: this.table, method: 'eq', args: [column, value] });
    this.filters.push([column, value]);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.ops.push({ table: this.table, method: 'order', args: [column, options] });
    this.orderSpec = { column, ascending: options?.ascending ?? true };
    return this;
  }

  limit(count: number): this {
    this.ops.push({ table: this.table, method: 'limit', args: [count] });
    this.limitN = count;
    return this;
  }

  maybeSingle(): this {
    this.single = true;
    this.ops.push({ table: this.table, method: 'maybeSingle', args: [] });
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every(([column, value]) => row[column] === value);
  }

  private apply(): unknown {
    const rows = this.backend.rows(this.table);
    if (this.op === 'upsert' && this.payload) {
      const conflict = this.conflict;
      const payload = this.payload;
      const existing = conflict.length
        ? rows.find((row) => conflict.every((column) => row[column] === payload[column]))
        : undefined;
      if (!existing) {
        rows.push(withDefaults(this.table, payload));
      } else if (!this.ignoreDuplicates) {
        Object.assign(existing, payload);
      }
      const stored = conflict.length
        ? rows.find((row) => conflict.every((column) => row[column] === payload[column]))
        : rows[rows.length - 1];
      return this.single ? (stored ?? null) : [stored];
    }

    let selected = rows.filter((row) => this.matches(row));
    if (this.op === 'update' && this.payload) {
      for (const row of selected) Object.assign(row, this.payload);
    }
    if (this.orderSpec) {
      const { column, ascending } = this.orderSpec;
      selected = [...selected].sort((a, b) => {
        const left = String(a[column]);
        const right = String(b[column]);
        if (left === right) return 0;
        return ascending ? (left < right ? -1 : 1) : left < right ? 1 : -1;
      });
    }
    if (this.limitN !== null) selected = selected.slice(0, this.limitN);
    if (this.single) return selected[0] ?? null;
    return selected;
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.apply(), error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

/**
 * Emulates the two SECURITY DEFINER writers the store now calls.
 *
 * They are the only way `safe_deployments` can be written, and they are scoped
 * to the caller's own row, so the fake enforces the same two properties the SQL
 * does: a prediction is idempotent on `safe_address`, and an outcome can only
 * move a row that already exists.
 */
function createFakeClient(backend: FakeBackend): {
  readonly client: SupabaseClient;
  readonly ops: RecordedCall[];
} {
  const ops: RecordedCall[] = [];
  const client = {
    from(table: string) {
      return new FakeQuery(table, backend, ops);
    },
    rpc(fn: string, args: Row) {
      ops.push({ table: 'rpc', method: fn, args: [args] });
      const rows = backend.rows('safe_deployments');
      const address = args.p_safe_address as string;

      if (fn === 'record_safe_prediction') {
        let row = rows.find((r) => r.safe_address === address);
        if (!row) {
          row = withDefaults('safe_deployments', {
            profile_id: 'user-1',
            safe_address: address,
            status: 'predicted',
            deployment_tx_hash: null,
            deployment_chain_id: 11155111,
            predicted_l2_addresses: args.p_predicted_l2_addresses,
            safe_version: args.p_safe_version,
            factory: args.p_factory,
            singleton: args.p_singleton,
            initializer: args.p_initializer,
            handler: args.p_handler,
            owner: args.p_owner,
            threshold: 1,
            salt: args.p_salt,
            creation_code_assumptions: args.p_creation_code_assumptions,
            provenance: 'unapproved',
          });
          rows.push(row);
        }
        return Promise.resolve({ data: row, error: null });
      }

      if (fn === 'record_safe_deployment_outcome') {
        const row = rows.find((r) => r.safe_address === address);
        if (!row) {
          return Promise.resolve({
            data: null,
            error: { message: `no Safe prediction for ${address} belongs to the current resident` },
          });
        }
        const status = args.p_status as string;
        row.status = status;
        if (status === 'deployed') {
          row.provenance = 'approved';
          row.failure_reason = null;
          row.deployed_at = NOW;
          if (args.p_deployment_tx_hash) row.deployment_tx_hash = args.p_deployment_tx_hash;
        } else {
          row.failure_reason = args.p_failure_reason;
          row.failed_at = NOW;
        }
        row.updated_at = NOW;
        return Promise.resolve({ data: row, error: null });
      }

      return Promise.resolve({ data: null, error: { message: `unknown function ${fn}` } });
    },
  };
  return { client: client as unknown as SupabaseClient, ops };
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const SAFE = '0x1111111111111111111111111111111111111111' as const;
const OTHER_SAFE = '0x9999999999999999999999999999999999999999' as const;
const OWNER = '0x2222222222222222222222222222222222222222' as const;
const OTHER_OWNER = '0x3333333333333333333333333333333333333333' as const;
const INITIALIZER = '0x1234' as const;
const INIT_HASH = `0x${'22'.repeat(32)}` as const;
const SALT = `0x${'33'.repeat(32)}` as const;
const INIT_CODE_HASH = `0x${'44'.repeat(32)}` as const;
const TX_HASH = `0x${'ab'.repeat(32)}` as const;

const PREDICTION: SafePredictionInput = {
  profileId: 'user-1',
  safeAddress: SAFE,
  owner: OWNER,
  initializer: INITIALIZER,
  initializerHash: INIT_HASH,
  saltNonce: '42',
  salt: SALT,
  initCodeHash: INIT_CODE_HASH,
};

function storeOver(
  backend: FakeBackend,
): ReturnType<typeof createSafeDeploymentStore> {
  const session = createFakeClient(backend);
  return createSafeDeploymentStore({
    getClient: async () => session.client,
  });
}

/* -------------------------------------------------------------------------- */
/* Manifest builder                                                           */
/* -------------------------------------------------------------------------- */

describe('buildSafeDeploymentManifest', () => {
  it('fills the frozen inputs from @kade/shared rather than re-declaring them', () => {
    const deployment = SAFE_DEPLOYMENTS[ACTIVE_SAFE_VERSION];
    const manifest = buildSafeDeploymentManifest(PREDICTION);

    expect(manifest.safeVersion).toBe(ACTIVE_SAFE_VERSION);
    expect(manifest.factory).toBe(deployment.safeProxyFactory.value);
    expect(manifest.singleton).toBe(deployment.safeL2.value);
    expect(manifest.handler).toBe(deployment.compatibilityFallbackHandler.value);
    expect(manifest.threshold).toBe(1);
    expect(manifest.deploymentChainId).toBe(11155111);
    expect(manifest.predictedL2Addresses).toEqual([
      { chainId: 84532, name: 'Base Sepolia', address: SAFE },
    ]);
    expect(manifest.deploymentTxHash).toBeNull();
    expect(manifest.provenance).toBe('unapproved');
    expect(manifest.creationCodeAssumptions.proxyCreationCodeHash).toBe(
      DEPLOYED_SAFE_PROXY_CREATION_CODE_HASH,
    );
    expect(manifest.creationCodeAssumptions.chainSpecific).toBe(false);
  });

  it('refuses an L2 prediction that is not the deployment address', () => {
    expect(() =>
      buildSafeDeploymentManifest({
        ...PREDICTION,
        predictedL2Addresses: [
          { chainId: 84532, name: 'Base Sepolia', address: OTHER_SAFE },
        ],
      }),
    ).toThrow(/one address|mismatch/i);
  });

  it('refuses a malformed address instead of persisting it', () => {
    expect(() =>
      buildSafeDeploymentManifest({ ...PREDICTION, owner: '0xnothex' }),
    ).toThrow(/owner/);
  });
});

/* -------------------------------------------------------------------------- */
/* Prediction persistence                                                     */
/* -------------------------------------------------------------------------- */

describe('recordPrediction', () => {
  it('persists the prediction complete, with every manifest input', async () => {
    const backend = new FakeBackend();
    const session = createFakeClient(backend);
    const store = createSafeDeploymentStore({
      getClient: async () => session.client,
    });

    const saved = await store.recordPrediction(PREDICTION);

    const call = session.ops.find(
      (op) => op.method === 'record_safe_prediction',
    );
    const row = call?.args[0] as Row;
    expect(row).toMatchObject({
      p_safe_address: SAFE,
      p_safe_version: ACTIVE_SAFE_VERSION,
      p_factory: SAFE_DEPLOYMENTS[ACTIVE_SAFE_VERSION].safeProxyFactory.value,
      p_singleton: SAFE_DEPLOYMENTS[ACTIVE_SAFE_VERSION].safeL2.value,
      p_initializer: INITIALIZER,
      p_handler: SAFE_DEPLOYMENTS[ACTIVE_SAFE_VERSION].compatibilityFallbackHandler.value,
      p_owner: OWNER,
      p_salt: { saltNonce: '42', initializerHash: INIT_HASH, salt: SALT },
      p_creation_code_assumptions: {
        proxyCreationCodeHash: DEPLOYED_SAFE_PROXY_CREATION_CODE_HASH,
        initCodeHash: INIT_CODE_HASH,
        initCodeFormula: 'proxyCreationCode ++ uint256(uint160(singleton))',
        saltFormula: 'keccak256(keccak256(initializer) ++ uint256(saltNonce))',
        create2Formula: 'keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12:]',
        chainSpecific: false,
      },
    });

    expect(saved.status).toBe('predicted');
    expect(saved.manifest.safeAddress).toBe(SAFE);
    expect(saved.manifest.owner).toBe(OWNER);
    expect(saved.manifest.creationCodeAssumptions.initCodeHash).toBe(INIT_CODE_HASH);
  });

  it('is idempotent: a repeat prediction is the same row and cannot move the inputs', async () => {
    const backend = new FakeBackend();
    const store = storeOver(backend);

    const first = await store.recordPrediction(PREDICTION);
    const second = await store.recordPrediction({
      ...PREDICTION,
      owner: OTHER_OWNER,
      initializer: '0xbeef',
    });

    expect(backend.rows('safe_deployments')).toHaveLength(1);
    expect(second.manifest.owner).toBe(OWNER);
    expect(second.manifest.initializer).toBe(INITIALIZER);
    expect(second.predictedAt).toBe(first.predictedAt);
  });

  it('writes through the resident client, with no elevated client involved', async () => {
    const backend = new FakeBackend();
    const session = createFakeClient(backend);
    const store = createSafeDeploymentStore({
      getClient: async () => session.client,
    });

    await store.recordPrediction(PREDICTION);

    // The write is a SECURITY DEFINER call on the session client. There is no
    // service-role client anywhere in the store, so nothing to assert about one.
    expect(
      session.ops.some((op) => op.method === 'record_safe_prediction'),
    ).toBe(true);
    expect(session.ops.some((op) => op.method === 'upsert')).toBe(false);
  });

  it('surfaces a write failure rather than reporting a partial success', async () => {
    const backend = new FakeBackend();
    const failing = {
      rpc: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      from: () => {
        throw new Error('unexpected table access');
      },
    };
    const store = createSafeDeploymentStore({
      getClient: async () => failing as unknown as SupabaseClient,
    });

    await expect(store.recordPrediction(PREDICTION)).rejects.toBeInstanceOf(
      SafeDeploymentWriteError,
    );
    expect(backend.rows('safe_deployments')).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Deployment outcome                                                         */
/* -------------------------------------------------------------------------- */

describe('deployment outcomes', () => {
  it('cannot be recorded for an address that was never predicted', async () => {
    const backend = new FakeBackend();
    const store = storeOver(backend);

    await expect(
      store.recordDeployment({
        profileId: 'user-1',
        safeAddress: SAFE,
        deploymentTxHash: TX_HASH,
      }),
    ).rejects.toBeInstanceOf(SafeDeploymentNotPredictedError);

    expect(backend.rows('safe_deployments')).toHaveLength(0);
  });

  it('records a successful deployment on the predicted row and approves it', async () => {
    const backend = new FakeBackend();
    const store = storeOver(backend);
    await store.recordPrediction(PREDICTION);

    const saved = await store.recordDeployment({
      profileId: 'user-1',
      safeAddress: SAFE,
      deploymentTxHash: TX_HASH,
    });

    expect(saved.status).toBe('deployed');
    expect(saved.deploymentTxHash).toBe(TX_HASH);
    expect(saved.provenance).toBe('approved');
    expect(saved.deployedAt).not.toBeNull();
    expect(saved.manifest.deploymentTxHash).toBe(TX_HASH);
    expect(saved.manifest.provenance).toBe('approved');
    expect(backend.rows('safe_deployments')).toHaveLength(1);
  });

  it('marks an already-on-chain Safe deployed without clearing a recorded hash', async () => {
    const backend = new FakeBackend();
    const store = storeOver(backend);
    await store.recordPrediction(PREDICTION);
    await store.recordDeployment({
      profileId: 'user-1',
      safeAddress: SAFE,
      deploymentTxHash: TX_HASH,
    });

    // A retry that finds the contract present has no hash to add. It must not
    // regress the row to "no transaction".
    const again = await store.recordDeployment({
      profileId: 'user-1',
      safeAddress: SAFE,
      deploymentTxHash: null,
    });

    expect(again.status).toBe('deployed');
    expect(again.deploymentTxHash).toBe(TX_HASH);
    expect(backend.rows('safe_deployments')).toHaveLength(1);
  });

  it('reconciles a failed row to deployed when a retry finds the Safe on chain', async () => {
    const backend = new FakeBackend();
    const store = storeOver(backend);
    await store.recordPrediction(PREDICTION);
    await store.recordDeploymentFailure({
      profileId: 'user-1',
      safeAddress: SAFE,
      reason: 'insufficient funds',
    });

    const reconciled = await store.recordDeployment({
      profileId: 'user-1',
      safeAddress: SAFE,
      deploymentTxHash: null,
    });

    expect(reconciled.status).toBe('deployed');
    expect(reconciled.failureReason).toBeNull();
    expect(reconciled.provenance).toBe('approved');
    expect(reconciled.deploymentTxHash).toBeNull();
    expect(backend.rows('safe_deployments')).toHaveLength(1);
  });

  it('records a failed deployment without creating a row', async () => {
    const backend = new FakeBackend();
    const store = storeOver(backend);
    await store.recordPrediction(PREDICTION);

    const saved = await store.recordDeploymentFailure({
      profileId: 'user-1',
      safeAddress: SAFE,
      reason: 'nonce too low',
    });

    expect(saved.status).toBe('failed');
    expect(saved.failureReason).toBe('nonce too low');
    expect(saved.provenance).toBe('unapproved');
    expect(backend.rows('safe_deployments')).toHaveLength(1);

    await expect(
      store.recordDeploymentFailure({
        profileId: 'user-1',
        safeAddress: OTHER_SAFE,
        reason: 'never predicted',
      }),
    ).rejects.toBeInstanceOf(SafeDeploymentNotPredictedError);
  });
});

/* -------------------------------------------------------------------------- */
/* Reads are scoped to the resident                                           */
/* -------------------------------------------------------------------------- */

function seededRow(profileId: string, safeAddress: string): Row {
  return {
    profile_id: profileId,
    safe_address: safeAddress,
    status: 'predicted',
    deployment_tx_hash: null,
    deployment_chain_id: 11155111,
    predicted_l2_addresses: [
      { chainId: 84532, name: 'Base Sepolia', address: safeAddress },
    ],
    safe_version: ACTIVE_SAFE_VERSION,
    factory: SAFE_DEPLOYMENTS[ACTIVE_SAFE_VERSION].safeProxyFactory.value,
    singleton: SAFE_DEPLOYMENTS[ACTIVE_SAFE_VERSION].safeL2.value,
    initializer: INITIALIZER,
    handler: SAFE_DEPLOYMENTS[ACTIVE_SAFE_VERSION].compatibilityFallbackHandler.value,
    owner: OWNER,
    threshold: 1,
    salt: { saltNonce: '42', initializerHash: INIT_HASH, salt: SALT },
    creation_code_assumptions: {
      proxyCreationCodeHash: DEPLOYED_SAFE_PROXY_CREATION_CODE_HASH,
      initCodeHash: INIT_CODE_HASH,
      initCodeFormula: 'proxyCreationCode ++ uint256(uint160(singleton))',
      saltFormula: 'keccak256(keccak256(initializer) ++ uint256(saltNonce))',
      create2Formula: 'keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12:]',
      chainSpecific: false,
    },
    provenance: 'unapproved',
    failure_reason: null,
    predicted_at: NOW,
    queued_at: null,
    deployed_at: null,
    failed_at: null,
    updated_at: NOW,
  };
}

describe('reads', () => {
  it('scopes getByAddress to the resident and the address', async () => {
    const backend = new FakeBackend();
    backend.seed('safe_deployments', seededRow('user-1', SAFE));
    backend.seed('safe_deployments', seededRow('user-2', OTHER_SAFE));
    const session = createFakeClient(backend);
    const store = createSafeDeploymentStore({
      getClient: async () => session.client,
    });

    const found = await store.getByAddress('user-1', SAFE);
    expect(found?.safeAddress).toBe(SAFE);
    expect(await store.getByAddress('user-2', SAFE)).toBeNull();

    const eqs = session.ops
      .filter((op) => op.method === 'eq')
      .map((op) => op.args);
    expect(eqs).toContainEqual(['profile_id', 'user-1']);
    expect(eqs).toContainEqual(['safe_address', SAFE]);
  });

  it('scopes getForProfile to the resident', async () => {
    const backend = new FakeBackend();
    backend.seed('safe_deployments', seededRow('user-1', SAFE));
    backend.seed('safe_deployments', seededRow('user-2', OTHER_SAFE));
    const store = storeOver(backend);

    const found = await store.getForProfile('user-2');
    expect(found?.profileId).toBe('user-2');
    expect(found?.safeAddress).toBe(OTHER_SAFE);
  });
});

/* -------------------------------------------------------------------------- */
/* Configuration honesty                                                      */
/* -------------------------------------------------------------------------- */

describe('safeDeploymentStore', () => {
  it('fails explicitly when Supabase is not configured', () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    try {
      expect(() => safeDeploymentStore()).toThrow(
        SafeDeploymentNotConfiguredError,
      );
    } finally {
      if (url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      if (anon !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon;
    }
  });
});
