import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildOwnershipMessage,
  issueOwnershipChallenge,
  OWNERSHIP_PROOF_CHAIN_ID,
  readNonceFromMessage,
  verifyWalletOwnership,
} from '@/lib/wallet/ownership';

/**
 * The signed-wallet ownership proof (week-2 contract D17).
 *
 * The cryptography is real: the tests sign with viem accounts and verify through
 * the module, so a passing test means the EIP-191 recovery and the address match
 * actually work. Only the Supabase seam is faked, so the tests pin the wiring:
 * a session is required, the challenge is stored with its exact message, a valid
 * signature records the proof, and a tampered message or a wrong signer is
 * refused without ever writing.
 */

const hoisted = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: hoisted.createSupabaseServerClient,
}));

/** Canonical test keys (Hardhat accounts 0 and 1) — public, never funded. */
const KEY_A = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const KEY_B = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const accountA = privateKeyToAccount(KEY_A);
const accountB = privateKeyToAccount(KEY_B);

const NONCE = 'b'.repeat(32);
const ISSUED_AT = '2026-09-22T10:00:00.000Z';
const EXPIRES_AT = '2026-09-22T10:10:00.000Z';
/** The stored row's expiry is checked against the wall clock, so keep it ahead. */
const FUTURE_EXPIRES_AT = new Date(Date.now() + 5 * 60 * 1000).toISOString();

function issuedMessage(address: string, nonce = NONCE): string {
  return buildOwnershipMessage({
    domain: 'localhost:3000',
    address,
    uri: 'http://localhost:3000/',
    chainId: OWNERSHIP_PROOF_CHAIN_ID,
    nonce,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
  });
}

interface ChallengeRow {
  readonly message: string;
  readonly expires_at: string;
  readonly consumed_at: string | null;
}

interface RpcCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

interface FakeOptions {
  readonly user?: { id: string } | null;
  readonly challenge?: ChallengeRow | null;
  readonly challengeError?: { message: string } | null;
  readonly insertError?: { message: string } | null;
  readonly rpcError?: { message: string } | null;
}

function createFakeClient(options: FakeOptions = {}): {
  readonly client: SupabaseClient;
  readonly inserts: readonly Record<string, unknown>[];
  readonly rpcCalls: RpcCall[];
} {
  const inserts: Record<string, unknown>[] = [];
  const rpcCalls: RpcCall[] = [];

  const client = {
    auth: {
      async getUser() {
        const user =
          options.user === undefined ? { id: 'user-1' } : options.user;
        return { data: { user }, error: null };
      },
    },
    from(table: string) {
      const builder = {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, ...row });
          return Promise.resolve({ data: null, error: options.insertError ?? null });
        },
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        async maybeSingle() {
          return {
            data: options.challengeError ? null : (options.challenge ?? null),
            error: options.challengeError ?? null,
          };
        },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return { data: null, error: options.rpcError ?? null };
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    inserts,
    rpcCalls,
  };
}

function liveChallenge(address: string, message = issuedMessage(address)): ChallengeRow {
  return { message, expires_at: FUTURE_EXPIRES_AT, consumed_at: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
});

describe('buildOwnershipMessage', () => {
  it('is EIP-4361-shaped and carries the address, chain and nonce', () => {
    const message = issuedMessage(accountA.address);
    expect(message).toContain(
      'localhost:3000 wants you to sign in with your Ethereum account:',
    );
    expect(message).toContain(accountA.address);
    expect(message).toContain(`Chain ID: ${OWNERSHIP_PROOF_CHAIN_ID}`);
    expect(message).toContain(`Nonce: ${NONCE}`);
    expect(readNonceFromMessage(message)).toBe(NONCE);
  });
});

describe('issueOwnershipChallenge', () => {
  it('requires an authenticated session', async () => {
    const { client, inserts } = createFakeClient({ user: null });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(issueOwnershipChallenge(accountA.address)).rejects.toThrow(
      /signed-in session/i,
    );
    expect(inserts).toHaveLength(0);
  });

  it('refuses a value that is not a valid EVM address', async () => {
    const { client, inserts } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(issueOwnershipChallenge('not-an-address')).rejects.toThrow(
      /not a recognised EVM address/i,
    );
    expect(inserts).toHaveLength(0);
  });

  it('stores a fresh nonce and the exact issued message, and returns them', async () => {
    const { client, inserts } = createFakeClient();
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const challenge = await issueOwnershipChallenge(accountA.address.toLowerCase());

    expect(challenge.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(challenge.message).toContain(`Nonce: ${challenge.nonce}`);
    expect(challenge.message).toContain(accountA.address);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      table: 'wallet_ownership_challenges',
      profile_id: 'user-1',
      address: accountA.address,
      nonce: challenge.nonce,
      message: challenge.message,
    });
    expect(typeof inserts[0]?.expires_at).toBe('string');
  });
});

describe('verifyWalletOwnership', () => {
  it('accepts a signature over the issued challenge and records the proof', async () => {
    const message = issuedMessage(accountA.address);
    const signature = await accountA.signMessage({ message });
    const { client, rpcCalls } = createFakeClient({
      challenge: liveChallenge(accountA.address, message),
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const result = await verifyWalletOwnership({
      address: accountA.address,
      message,
      signature,
    });

    expect(result).toEqual({ ok: true });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({
      name: 'record_wallet_ownership',
      args: {
        p_address: accountA.address,
        p_nonce: NONCE,
        p_message: message,
        p_signature: signature,
      },
    });
  });

  it('accepts a lower-case address input and compares on the canonical form', async () => {
    const message = issuedMessage(accountA.address);
    const signature = await accountA.signMessage({ message });
    const { client, rpcCalls } = createFakeClient({
      challenge: liveChallenge(accountA.address, message),
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const result = await verifyWalletOwnership({
      address: accountA.address.toLowerCase(),
      message,
      signature,
    });

    expect(result).toEqual({ ok: true });
    expect(rpcCalls[0]?.args.p_address).toBe(accountA.address);
  });

  it('refuses a signature made over a different (tampered) message', async () => {
    const original = issuedMessage(accountA.address);
    const signature = await accountA.signMessage({ message: original });
    // The stored challenge is the tampered message, so the string match passes
    // and the refusal is the cryptographic recovery finding a different signer.
    const tampered = `${original}\n\npay 1 ETH to 0x000000000000000000000000000000000000dead`;
    const { client, rpcCalls } = createFakeClient({
      challenge: liveChallenge(accountA.address, tampered),
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const result = await verifyWalletOwnership({
      address: accountA.address,
      message: tampered,
      signature,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not match the wallet address/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a message that is not the issued challenge', async () => {
    const issued = issuedMessage(accountA.address);
    const other = issuedMessage(accountA.address, 'c'.repeat(32));
    const signature = await accountA.signMessage({ message: other });
    const { client, rpcCalls } = createFakeClient({
      challenge: liveChallenge(accountA.address, issued),
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const result = await verifyWalletOwnership({
      address: accountA.address,
      message: other,
      signature,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not the issued challenge/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a signature from the wrong signer', async () => {
    const message = issuedMessage(accountA.address);
    const signature = await accountB.signMessage({ message });
    const { client, rpcCalls } = createFakeClient({
      challenge: liveChallenge(accountA.address, message),
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const result = await verifyWalletOwnership({
      address: accountA.address,
      message,
      signature,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not match the wallet address/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a malformed signature', async () => {
    const message = issuedMessage(accountA.address);
    const { client, rpcCalls } = createFakeClient({
      challenge: liveChallenge(accountA.address, message),
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const result = await verifyWalletOwnership({
      address: accountA.address,
      message,
      signature: '0xnot-a-signature',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not be verified/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses when there is no live challenge', async () => {
    const message = issuedMessage(accountA.address);
    const signature = await accountA.signMessage({ message });
    const { client, rpcCalls } = createFakeClient({ challenge: null });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const result = await verifyWalletOwnership({
      address: accountA.address,
      message,
      signature,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no live challenge/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses a consumed challenge', async () => {
    const message = issuedMessage(accountA.address);
    const signature = await accountA.signMessage({ message });
    const { client, rpcCalls } = createFakeClient({
      challenge: {
        message,
        expires_at: EXPIRES_AT,
        consumed_at: '2026-09-22T09:59:00.000Z',
      },
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const result = await verifyWalletOwnership({
      address: accountA.address,
      message,
      signature,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already been used/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it('refuses an expired challenge', async () => {
    const message = issuedMessage(accountA.address);
    const signature = await accountA.signMessage({ message });
    const { client, rpcCalls } = createFakeClient({
      challenge: {
        message,
        expires_at: '2000-01-01T00:00:00.000Z',
        consumed_at: null,
      },
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const result = await verifyWalletOwnership({
      address: accountA.address,
      message,
      signature,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/expired/i);
    expect(rpcCalls).toHaveLength(0);
  });

  it('surfaces a database refusal without claiming success', async () => {
    const message = issuedMessage(accountA.address);
    const signature = await accountA.signMessage({ message });
    const { client } = createFakeClient({
      challenge: liveChallenge(accountA.address, message),
      rpcError: { message: 'no linked wallet with this address' },
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const result = await verifyWalletOwnership({
      address: accountA.address,
      message,
      signature,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no linked wallet/i);
  });

  it('refuses without a session', async () => {
    const message = issuedMessage(accountA.address);
    const signature = await accountA.signMessage({ message });
    const { client, rpcCalls } = createFakeClient({ user: null });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    const result = await verifyWalletOwnership({
      address: accountA.address,
      message,
      signature,
    });

    expect(result.ok).toBe(false);
    expect(rpcCalls).toHaveLength(0);
  });
});
