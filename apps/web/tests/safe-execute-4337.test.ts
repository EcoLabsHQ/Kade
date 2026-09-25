import { describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import {
  executeResidentSafeBatch,
  pimlicoBundlerUrl,
  readPimlicoConfig,
  type Safe4337PackLike,
} from '@/lib/safe/execute-safe-4337';

/**
 * The resident-Safe execution, on Safe's documented ERC-4337 flow.
 *
 * These tests pin the two conditions that must hold before anything is sent —
 * a deployed signer and the Pimlico keys — and the Safe sequence itself:
 * init → createTransaction → signSafeOperation → executeTransaction → receipt.
 *
 * The pack is injected, so no network, no bundler and no key is needed, and no
 * test can broadcast.
 */

const SAFE = '0x1111111111111111111111111111111111111111' as Address;
const SIGNER = '0x2222222222222222222222222222222222222222' as Address;
const HASH = '0xabc0000000000000000000000000000000000000000000000000000000000abc' as Hex;

const env = (values: Record<string, string>): NodeJS.ProcessEnv =>
  values as unknown as NodeJS.ProcessEnv;

const ENV = env({ PIMLICO_API_KEY: 'pim_test', PIMLICO_POLICY_ID: 'sp_test' });

const CALLS = [
  { to: '0xaaaa000000000000000000000000000000000001' as Address, value: 0n, data: '0xdead' as Hex },
];

/** A pack stub that records the documented call order. */
function fakePack(overrides: Partial<Safe4337PackLike> = {}): {
  pack: Safe4337PackLike;
  order: string[];
} {
  const order: string[] = [];
  const pack: Safe4337PackLike = {
    createTransaction: vi.fn(async () => {
      order.push('create');
      return { op: 1 };
    }),
    signSafeOperation: vi.fn(async () => {
      order.push('sign');
      return { signed: true };
    }),
    executeTransaction: vi.fn(async () => {
      order.push('submit');
      return HASH;
    }),
    getUserOperationReceipt: vi.fn(async () => {
      order.push('receipt');
      return { receipt: { status: 'success', transactionHash: '0xfeed' as Hex } };
    }),
    ...overrides,
  };
  return { pack, order };
}

function deps(ownerAddress: Address | null, pack: Safe4337PackLike) {
  return {
    safeAddress: SAFE,
    ownerAddress,
    initPack: vi.fn(async () => pack),
  };
}

describe('readPimlicoConfig', () => {
  it('returns null unless both keys are present', () => {
    expect(readPimlicoConfig(11155111, env({}))).toBeNull();
    expect(
      readPimlicoConfig(11155111, env({ PIMLICO_API_KEY: 'k' })),
    ).toBeNull();
    expect(
      readPimlicoConfig(11155111, env({ PIMLICO_POLICY_ID: 'p' })),
    ).toBeNull();
  });

  it('builds the chain-scoped bundler URL', () => {
    const config = readPimlicoConfig(11155111, ENV);
    expect(config).not.toBeNull();
    expect(pimlicoBundlerUrl(config!)).toBe(
      'https://api.pimlico.io/v2/11155111/rpc?apikey=pim_test',
    );
  });
});

describe('executeResidentSafeBatch', () => {
  it('refuses without the Pimlico keys and reaches no pack', async () => {
    const { pack } = fakePack();
    const d = deps(SIGNER, pack);
    const outcome = await executeResidentSafeBatch(CALLS, d, env({}));

    expect(outcome.status).toBe('not-configured');
    expect(outcome.sent).toBe(false);
    expect(d.initPack).not.toHaveBeenCalled();
    expect(pack.createTransaction).not.toHaveBeenCalled();
  });

  it('refuses when the signer has no code, and reaches no pack', async () => {
    const { pack } = fakePack();
    const d = deps(null, pack);
    const outcome = await executeResidentSafeBatch(CALLS, d, ENV);

    expect(outcome.status).toBe('blocked');
    expect(outcome.sent).toBe(false);
    expect(d.initPack).not.toHaveBeenCalled();
    expect(pack.signSafeOperation).not.toHaveBeenCalled();
  });

  it('follows the documented Safe sequence and reports sent only on a success receipt', async () => {
    const { pack, order } = fakePack();
    const outcome = await executeResidentSafeBatch(CALLS, deps(SIGNER, pack), ENV);

    expect(order).toEqual(['create', 'sign', 'submit', 'receipt']);
    expect(outcome.status).toBe('sent');
    expect(outcome.sent).toBe(true);
    if (outcome.status === 'sent') {
      expect(outcome.userOperationHash).toBe(HASH);
      expect(outcome.transactionHash).toBe('0xfeed');
    }
  });

  it('does not report sent when the receipt reverted', async () => {
    const { pack } = fakePack({
      getUserOperationReceipt: vi.fn(async () => ({
        receipt: { status: 'reverted' },
      })),
    });
    const outcome = await executeResidentSafeBatch(CALLS, deps(SIGNER, pack), ENV);

    expect(outcome.status).toBe('failed');
    // It was submitted, so `sent` is true — but the status is a failure, never
    // a success. The two are separate on purpose.
    expect(outcome.sent).toBe(true);
    if (outcome.status === 'failed') expect(outcome.stage).toBe('receipt');
  });

  it('reports a signing failure without claiming anything was sent', async () => {
    const { pack } = fakePack({
      signSafeOperation: vi.fn(async () => {
        throw new Error('user rejected the passkey prompt');
      }),
    });
    const outcome = await executeResidentSafeBatch(CALLS, deps(SIGNER, pack), ENV);

    expect(outcome.status).toBe('failed');
    expect(outcome.sent).toBe(false);
    if (outcome.status === 'failed') {
      expect(outcome.stage).toBe('sign');
      expect(outcome.reason).toMatch(/rejected/);
    }
  });
});
