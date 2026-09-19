import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chainByChainId } from '@kade/shared';
import {
  PreDepositNotConfiguredError,
  PreDepositVerificationMismatchError,
  UnsupportedPreDepositChainError,
  createPreDepositStore,
  mockTxHash,
  preDepositStore,
  type UnverifiedTxHash,
} from '@/lib/payments/pre-deposit';

/**
 * Pre-deposit persistence.
 *
 * The transaction hash is mocked in Week 1, so the things worth pinning are:
 *
 *   - the deposit records USDC, the chain and the amount;
 *   - it is stored and returned as unverified, and the module has no way to
 *     write a verified record;
 *   - a stored `verified` row is never silently relabelled unverified;
 *   - a repeat (chain, hash) is the same row, not a duplicate;
 *   - reads are scoped to the resident.
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

class FakeQuery {
  private readonly filters: Array<readonly [string, unknown]> = [];
  private op: 'select' | 'upsert' | null = null;
  private payload: Row | null = null;
  private conflict: string[] = [];
  private ignoreDuplicates = false;
  private single = false;
  private orderSpec: { column: string; ascending: boolean } | null = null;

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
        rows.push({
          verification_status: 'unverified',
          verified_at: null,
          created_at: NOW,
          ...payload,
        });
      } else if (!this.ignoreDuplicates) {
        Object.assign(existing, payload);
      }
      const stored = conflict.length
        ? rows.find((row) => conflict.every((column) => row[column] === payload[column]))
        : rows[rows.length - 1];
      return this.single ? (stored ?? null) : [stored];
    }

    const selected = rows.filter((row) => this.matches(row));
    if (this.orderSpec) {
      const { column, ascending } = this.orderSpec;
      selected.sort((a, b) => {
        const left = String(a[column]);
        const right = String(b[column]);
        if (left === right) return 0;
        return ascending ? (left < right ? -1 : 1) : left < right ? 1 : -1;
      });
    }
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

function createFakeClient(backend: FakeBackend): {
  readonly client: SupabaseClient;
  readonly ops: RecordedCall[];
} {
  const ops: RecordedCall[] = [];
  const client = {
    from(table: string) {
      return new FakeQuery(table, backend, ops);
    },
  };
  return { client: client as unknown as SupabaseClient, ops };
}

function storeOver(backend: FakeBackend): ReturnType<typeof createPreDepositStore> {
  const session = createFakeClient(backend);
  return createPreDepositStore({ getClient: async () => session.client });
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const SAFE = '0x1111111111111111111111111111111111111111' as const;
const OTHER_SAFE = '0x9999999999999999999999999999999999999999' as const;
const BASE_SEPOLIA = 84532;
const TX = mockTxHash(`0x${'cd'.repeat(32)}`);
const OTHER_TX = mockTxHash(`0x${'ef'.repeat(32)}`);

const USDC = chainByChainId(BASE_SEPOLIA)?.usdcAddress.value;

/* -------------------------------------------------------------------------- */
/* Recording                                                                  */
/* -------------------------------------------------------------------------- */

describe('record pre-deposit', () => {
  it('stores USDC, the chain and the amount, and marks it unverified', async () => {
    const backend = new FakeBackend();
    const session = createFakeClient(backend);
    const store = createPreDepositStore({
      getClient: async () => session.client,
    });

    const saved = await store.record({
      profileId: 'user-1',
      safeAddress: SAFE,
      chainId: BASE_SEPOLIA,
      amountUsdc: '250.5',
      txHash: TX,
    });

    const upsert = session.ops.find((op) => op.method === 'upsert');
    const row = upsert?.args[0] as Row;
    expect(row).toMatchObject({
      profile_id: 'user-1',
      safe_address: SAFE,
      chain_id: BASE_SEPOLIA,
      token_address: USDC,
      token_symbol: 'USDC',
      amount_usdc: '250.5',
      tx_hash: TX,
    });
    // The module never writes the server-owned verification columns.
    expect(row).not.toHaveProperty('verification_status');
    expect(row).not.toHaveProperty('verified_at');
    expect(upsert?.args[1]).toEqual({
      onConflict: 'chain_id,tx_hash',
      ignoreDuplicates: true,
    });

    expect(saved.verification).toBe('unverified');
    expect(saved.tokenAddress).toBe(USDC);
    expect(saved.amountUsdc).toBe('250.5');
  });

  it('is idempotent: a repeat (chain, hash) is the same row', async () => {
    const backend = new FakeBackend();
    const store = storeOver(backend);

    await store.record({
      profileId: 'user-1',
      safeAddress: SAFE,
      chainId: BASE_SEPOLIA,
      amountUsdc: '10',
      txHash: TX,
    });
    const second = await store.record({
      profileId: 'user-1',
      safeAddress: SAFE,
      chainId: BASE_SEPOLIA,
      amountUsdc: '10',
      txHash: TX,
    });

    expect(backend.rows('safe_pre_deposits')).toHaveLength(1);
    expect(second.verification).toBe('unverified');
  });

  it('rejects a chain iteration 1 does not support', async () => {
    const backend = new FakeBackend();
    const store = storeOver(backend);
    for (const chainId of [1, 421614, 999999]) {
      await expect(
        store.record({
          profileId: 'user-1',
          safeAddress: SAFE,
          chainId,
          amountUsdc: '10',
          txHash: TX,
        }),
      ).rejects.toBeInstanceOf(UnsupportedPreDepositChainError);
    }
    expect(backend.rows('safe_pre_deposits')).toHaveLength(0);
  });

  it('rejects a malformed or non-positive amount', async () => {
    const backend = new FakeBackend();
    const store = storeOver(backend);
    await expect(
      store.record({
        profileId: 'user-1',
        safeAddress: SAFE,
        chainId: BASE_SEPOLIA,
        amountUsdc: '0',
        txHash: TX,
      }),
    ).rejects.toThrow(/positive decimal/i);
  });
});

/* -------------------------------------------------------------------------- */
/* The mocked hash cannot look verified                                       */
/* -------------------------------------------------------------------------- */

describe('mock transaction hash', () => {
  it('rejects a value that is not a 32-byte hex hash', () => {
    expect(() => mockTxHash('0xdeadbeef')).toThrow(/32 bytes/i);
  });

  it('never presents a stored verified row as unverified', async () => {
    const backend = new FakeBackend();
    backend.seed('safe_pre_deposits', {
      profile_id: 'user-1',
      safe_address: SAFE,
      chain_id: BASE_SEPOLIA,
      token_address: USDC,
      token_symbol: 'USDC',
      amount_usdc: '10',
      tx_hash: TX,
      verification_status: 'verified',
      verified_at: NOW,
      created_at: NOW,
    });
    const store = storeOver(backend);

    await expect(store.listForProfile('user-1')).rejects.toBeInstanceOf(
      PreDepositVerificationMismatchError,
    );
  });

  it('has no input through which a caller could mark a hash verified', () => {
    // The only input type carries an `UnverifiedTxHash`; a bare hash string is
    // not assignable. This is a compile-time guard made explicit at runtime.
    const input: Parameters<ReturnType<typeof createPreDepositStore>['record']>[0] = {
      profileId: 'user-1',
      safeAddress: SAFE,
      chainId: BASE_SEPOLIA,
      amountUsdc: '10',
      txHash: TX,
    };
    expect(input.txHash).toBe(TX);
    const bare = `0x${'cd'.repeat(32)}`;
    // @ts-expect-error a bare hash is not an UnverifiedTxHash
    const invalid: UnverifiedTxHash = bare;
    expect(typeof invalid).toBe('string');
  });
});

/* -------------------------------------------------------------------------- */
/* Reads are scoped to the resident                                           */
/* -------------------------------------------------------------------------- */

function seededDeposit(
  profileId: string,
  safeAddress: string,
  txHash: string,
): Row {
  return {
    profile_id: profileId,
    safe_address: safeAddress,
    chain_id: BASE_SEPOLIA,
    token_address: USDC,
    token_symbol: 'USDC',
    amount_usdc: '10',
    tx_hash: txHash,
    verification_status: 'unverified',
    verified_at: null,
    created_at: NOW,
  };
}

describe('reads', () => {
  it('scopes listForProfile to the resident', async () => {
    const backend = new FakeBackend();
    backend.seed('safe_pre_deposits', seededDeposit('user-1', SAFE, TX));
    backend.seed('safe_pre_deposits', seededDeposit('user-2', OTHER_SAFE, OTHER_TX));
    const session = createFakeClient(backend);
    const store = createPreDepositStore({ getClient: async () => session.client });

    const mine = await store.listForProfile('user-1');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.safeAddress).toBe(SAFE);

    const eqs = session.ops
      .filter((op) => op.method === 'eq')
      .map((op) => op.args);
    expect(eqs).toContainEqual(['profile_id', 'user-1']);
  });

  it('scopes getByIdentity to the resident, chain and hash', async () => {
    const backend = new FakeBackend();
    backend.seed('safe_pre_deposits', seededDeposit('user-1', SAFE, TX));
    const session = createFakeClient(backend);
    const store = createPreDepositStore({ getClient: async () => session.client });

    expect(await store.getByIdentity('user-1', BASE_SEPOLIA, TX)).not.toBeNull();
    expect(await store.getByIdentity('user-2', BASE_SEPOLIA, TX)).toBeNull();

    const eqs = session.ops
      .filter((op) => op.method === 'eq')
      .map((op) => op.args);
    expect(eqs).toContainEqual(['profile_id', 'user-1']);
    expect(eqs).toContainEqual(['chain_id', BASE_SEPOLIA]);
    expect(eqs).toContainEqual(['tx_hash', TX]);
  });
});

/* -------------------------------------------------------------------------- */
/* Configuration honesty                                                      */
/* -------------------------------------------------------------------------- */

describe('preDepositStore', () => {
  it('fails explicitly when Supabase is not configured', () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    try {
      expect(() => preDepositStore()).toThrow(PreDepositNotConfiguredError);
    } finally {
      if (url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      if (anon !== undefined) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = anon;
    }
  });
});
