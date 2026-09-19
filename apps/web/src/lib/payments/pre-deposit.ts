import type { SupabaseClient } from '@supabase/supabase-js';
import type { Hex } from 'viem';
import { chainByChainId, type Address } from '@kade/shared';
import { isAuthConfigured, readAuthEnv } from '@/lib/env';

/**
 * Pre-deposits to a resident's counterfactual Safe address.
 *
 * A resident can send USDC to their Safe before it is deployed. D4's
 * reproducibility inputs must therefore already be persisted (see
 * `@/lib/safe/manifest`), and this table's composite foreign key to
 * `safe_deployments (safe_address, profile_id)` makes that a database rule: a
 * pre-deposit cannot be recorded for an address that was never predicted, nor
 * against another resident's address.
 *
 * The transaction hash is MOCKED in Week 1. The caller supplies it, nothing
 * checks it against a chain receipt, and the record is stored and returned as
 * `unverified`. `UnverifiedTxHash` is a branded type, so a caller cannot pass a
 * bare string and mistake it for a confirmed transfer, and this module has no
 * way to express a verified deposit. When a real receipt check exists, it will
 * be the only writer of `verification_status = 'verified'`.
 *
 * The token is USDC, taken from `@kade/shared` chain configuration rather than
 * hard-coded per call site; the chain and amount are recorded with it.
 */

declare const unverifiedBrand: unique symbol;

/**
 * A transaction hash that has NOT been checked against a chain receipt.
 *
 * Constructed only by `mockTxHash`. The brand is the type-level half of "do not
 * let a mocked hash look verified".
 */
export type UnverifiedTxHash = Hex & { readonly [unverifiedBrand]: true };

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;

/**
 * Brand a hash as unverified.
 *
 * The name says what it is: in Week 1 the value is a mock supplied by the
 * caller, not the output of reading a transaction receipt.
 */
export function mockTxHash(hash: string): UnverifiedTxHash {
  if (!TX_HASH_PATTERN.test(hash)) {
    throw new Error(`A transaction hash must be 32 bytes of hex, got "${hash}".`);
  }
  return hash as UnverifiedTxHash;
}

export interface PreDepositInput {
  readonly profileId: string;
  /** The counterfactual Safe address the funds were sent to. */
  readonly safeAddress: Address;
  readonly chainId: number;
  /** Whole USDC as a decimal string, to avoid floating-point rounding. */
  readonly amountUsdc: string;
  /** Mocked for now; see `UnverifiedTxHash`. */
  readonly txHash: UnverifiedTxHash;
}

/** A stored pre-deposit. `verification` is `unverified` in Week 1, always. */
export interface PreDeposit {
  readonly profileId: string;
  readonly safeAddress: Address;
  readonly chainId: number;
  readonly tokenAddress: Address;
  readonly tokenSymbol: string;
  readonly amountUsdc: string;
  readonly txHash: Hex;
  readonly verification: 'unverified';
  readonly createdAt: string;
}

interface PreDepositRow {
  readonly profile_id: string;
  readonly safe_address: string;
  readonly chain_id: number;
  readonly token_address: string;
  readonly token_symbol: string;
  readonly amount_usdc: string;
  readonly tx_hash: string;
  readonly verification_status: string;
  readonly created_at: string;
}

/** Raised when a deposit names a chain iteration 1 does not support. */
export class UnsupportedPreDepositChainError extends Error {
  constructor(chainId: number) {
    super(
      `Chain ${chainId} is not an active iteration-1 testnet, so a pre-deposit ` +
        'cannot be recorded against it. Iteration 1 is all-testnet and ' +
        'Arbitrum Sepolia is deferred (contract section 2, item 7).',
    );
    this.name = 'UnsupportedPreDepositChainError';
  }
}

/** Raised when there is no Supabase configuration at all. */
export class PreDepositNotConfiguredError extends Error {
  constructor() {
    super(
      'Supabase is not configured, so pre-deposits cannot be recorded or ' +
        'read. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY ' +
        '(see .env.example).',
    );
    this.name = 'PreDepositNotConfiguredError';
  }
}

/** Raised if a row's stored verification state is not `unverified`. */
export class PreDepositVerificationMismatchError extends Error {
  constructor() {
    super(
      'A pre-deposit was stored with a verification state this build does not ' +
        'produce. Refusing to present it as unverified.',
    );
    this.name = 'PreDepositVerificationMismatchError';
  }
}

export interface PreDepositStore {
  /**
   * Record a mocked, unverified USDC pre-deposit. Idempotent on
   * `(chain_id, tx_hash)`.
   */
  record(input: PreDepositInput): Promise<PreDeposit>;
  /** List the resident's pre-deposits, newest first. */
  listForProfile(profileId: string): Promise<PreDeposit[]>;
  /** Load one by its (chain, hash) pair, scoped to the owner. */
  getByIdentity(
    profileId: string,
    chainId: number,
    txHash: UnverifiedTxHash,
  ): Promise<PreDeposit | null>;
}

export interface PreDepositStoreClients {
  /** Session-scoped client; row level security applies as the resident. */
  readonly getClient: () => Promise<SupabaseClient>;
}

function toPreDeposit(row: PreDepositRow): PreDeposit {
  if (row.verification_status !== 'unverified') {
    // Defensive: this build only writes unverified rows. A verified row means
    // some other writer exists, and it must not be silently labelled unverified.
    throw new PreDepositVerificationMismatchError();
  }
  return {
    profileId: row.profile_id,
    safeAddress: row.safe_address as Address,
    chainId: row.chain_id,
    tokenAddress: row.token_address as Address,
    tokenSymbol: row.token_symbol,
    amountUsdc: row.amount_usdc,
    txHash: row.tx_hash as Hex,
    verification: 'unverified',
    createdAt: row.created_at,
  };
}

function assertAmount(value: string): string {
  if (!AMOUNT_PATTERN.test(value) || Number(value) <= 0) {
    throw new Error(
      `amountUsdc must be a positive decimal with at most 6 places, got "${value}".`,
    );
  }
  return value;
}

function assertAddress(value: string, field: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${field} must be a 20-byte hex address, got "${value}".`);
  }
  return value as Address;
}

export function createPreDepositStore(
  clients: PreDepositStoreClients,
): PreDepositStore {
  async function loadByIdentity(
    profileId: string,
    chainId: number,
    txHash: UnverifiedTxHash,
  ): Promise<PreDeposit | null> {
    const client = await clients.getClient();
    const result = await client
      .from('safe_pre_deposits')
      .select('*')
      .eq('profile_id', profileId)
      .eq('chain_id', chainId)
      .eq('tx_hash', txHash)
      .maybeSingle();
    if (result.error) {
      throw new Error(`Loading the pre-deposit failed: ${result.error.message}`);
    }
    return result.data ? toPreDeposit(result.data as PreDepositRow) : null;
  }

  return {
    async record(input) {
      const safeAddress = assertAddress(input.safeAddress, 'safeAddress');
      const amountUsdc = assertAmount(input.amountUsdc);
      const chain = chainByChainId(input.chainId);
      // Iteration 1 is all-testnet (contract section 2, item 7), and Arbitrum
      // Sepolia is deferred. A deposit on any other chain is out of scope, so it
      // is refused rather than recorded against a token the build does not use.
      if (!chain || chain.env !== 'testnet' || !chain.active) {
        throw new UnsupportedPreDepositChainError(input.chainId);
      }
      const tokenAddress = assertAddress(
        chain.usdcAddress.value,
        'tokenAddress',
      );

      const client = await clients.getClient();

      // verification_status is deliberately absent: it is server-written and
      // the database default keeps the row unverified. `ignoreDuplicates` makes
      // a repeat (chain, hash) the same row rather than a duplicate.
      const upsert = await client.from('safe_pre_deposits').upsert(
        {
          profile_id: input.profileId,
          safe_address: safeAddress,
          chain_id: input.chainId,
          token_address: tokenAddress,
          token_symbol: 'USDC',
          amount_usdc: amountUsdc,
          tx_hash: input.txHash,
        },
        { onConflict: 'chain_id,tx_hash', ignoreDuplicates: true },
      );
      if (upsert.error) {
        throw new Error(
          `Storing the pre-deposit failed: ${upsert.error.message}`,
        );
      }

      const loaded = await loadByIdentity(
        input.profileId,
        input.chainId,
        input.txHash,
      );
      if (loaded === null) {
        throw new Error(
          'The pre-deposit was written but could not be read back; the record ' +
            'cannot be confirmed.',
        );
      }
      return loaded;
    },

    async listForProfile(profileId) {
      const client = await clients.getClient();
      const result = await client
        .from('safe_pre_deposits')
        .select('*')
        .eq('profile_id', profileId)
        .order('created_at', { ascending: false });
      if (result.error) {
        throw new Error(
          `Loading pre-deposits failed: ${result.error.message}`,
        );
      }
      const rows = (result.data ?? []) as PreDepositRow[];
      return rows.map(toPreDeposit);
    },

    getByIdentity(profileId, chainId, txHash) {
      return loadByIdentity(profileId, chainId, txHash);
    },
  };
}

/**
 * The store backed by the real Supabase client.
 *
 * Throws `PreDepositNotConfiguredError` when the database is not configured,
 * rather than returning a store that silently cannot persist.
 */
export function preDepositStore(): PreDepositStore {
  if (!isAuthConfigured(readAuthEnv())) {
    throw new PreDepositNotConfiguredError();
  }
  return createPreDepositStore({
    getClient: async () => {
      const { createSupabaseServerClient } = await import(
        '@/lib/supabase/server'
      );
      return createSupabaseServerClient();
    },
  });
}
