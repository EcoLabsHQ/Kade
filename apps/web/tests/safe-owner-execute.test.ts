import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  deriveSignerAddress,
  executeSafeOwnerCall,
  ownerSafeExecutor,
  type ProtocolKitLike,
  type SafeOwnerExecutionDependencies,
} from '@/lib/safe/owner-execute';

/**
 * The owner-Safe execution, signed by a server-held owner key.
 *
 * The properties under test: the exact call is built and signed once; a signer
 * that is not a Safe owner is refused before anything is signed; a malformed key
 * is refused; and the private key never appears in the result or in a log.
 */

const KEY = `0x${'11'.repeat(32)}` as Hex;
const SIGNER = getAddress(privateKeyToAccount(KEY).address);
const SAFE = '0x3333333333333333333333333333333333333333' as Address;
const MANAGER = '0x2222222222222222222222222222222222222222' as Address;
const CALL = {
  to: MANAGER,
  value: 0n,
  data: '0xdc8970be0000000000000000000000001111111111111111111111111111111111111111' as Hex,
};

interface Captured {
  readonly transactions: readonly { to: string; value: string; data: string }[];
}

function fakeDeps(options: {
  owners?: readonly string[];
  hash?: Hex;
  success?: boolean;
  captured?: Captured[];
}): SafeOwnerExecutionDependencies {
  const hash = options.hash ?? (`0x${'ab'.repeat(32)}` as Hex);
  return {
    async initSafe() {
      const protocolKit: ProtocolKitLike = {
        async getOwners() {
          return options.owners ?? [SIGNER];
        },
        async createTransaction(input) {
          options.captured?.push({ transactions: input.transactions });
          return { built: true };
        },
        async signTransaction() {
          return { signed: true };
        },
        async executeTransaction() {
          return { hash };
        },
      };
      return protocolKit;
    },
    async waitForReceipt() {
      return { blockNumber: 100n, success: options.success ?? true };
    },
  };
}

/** JSON with bigints rendered, for the leak assertions. */
function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deriveSignerAddress', () => {
  it('derives the public address and never the key', () => {
    const address = deriveSignerAddress(KEY);
    expect(address).toBe(SIGNER);
    expect(String(address)).not.toContain(KEY.slice(2));
  });

  it('is null for a malformed key', () => {
    expect(deriveSignerAddress('0x1234')).toBeNull();
    expect(deriveSignerAddress('not-a-key')).toBeNull();
  });
});

describe('executeSafeOwnerCall', () => {
  it('builds, signs and executes exactly one Safe transaction', async () => {
    const captured: Captured[] = [];
    const result = await executeSafeOwnerCall(
      {
        chainId: 42161,
        rpcUrl: 'https://arb.example',
        safeAddress: SAFE,
        privateKey: KEY,
        call: CALL,
      },
      fakeDeps({ captured }),
    );

    expect(result.success).toBe(true);
    expect(result.blockNumber).toBe(100n);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.transactions).toEqual([
      { to: MANAGER, value: '0', data: CALL.data },
    ]);
  });

  it('refuses a signer that is not an owner of the Safe', async () => {
    await expect(
      executeSafeOwnerCall(
        {
          chainId: 42161,
          rpcUrl: 'https://arb.example',
          safeAddress: SAFE,
          privateKey: KEY,
          call: CALL,
        },
        fakeDeps({ owners: ['0x9999999999999999999999999999999999999999'] }),
      ),
    ).rejects.toThrow(/not an owner/i);
  });

  it('refuses a malformed key before initialising anything', async () => {
    const initSafe = vi.fn();
    await expect(
      executeSafeOwnerCall(
        {
          chainId: 42161,
          rpcUrl: 'https://arb.example',
          safeAddress: SAFE,
          privateKey: 'nope',
          call: CALL,
        },
        { initSafe, waitForReceipt: async () => ({ blockNumber: 0n, success: true }) },
      ),
    ).rejects.toThrow(/not a valid 32-byte private key/i);
    expect(initSafe).not.toHaveBeenCalled();
  });

  it('never logs the signer key and never returns it', async () => {
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'debug').mockImplementation(() => {}),
    ];
    const initSafe = vi.fn(async () => ({
      async getOwners() {
        return [SIGNER];
      },
      async createTransaction() {
        return {};
      },
      async signTransaction() {
        return {};
      },
      async executeTransaction() {
        return { hash: `0x${'cd'.repeat(32)}` };
      },
    }));

    const result = await executeSafeOwnerCall(
      {
        chainId: 42161,
        rpcUrl: 'https://arb.example',
        safeAddress: SAFE,
        privateKey: KEY,
        call: CALL,
      },
      { initSafe, waitForReceipt: async () => ({ blockNumber: 1n, success: true }) },
    );

    // The key reaches the SDK init (it must) but nothing else.
    expect(initSafe).toHaveBeenCalledWith(
      expect.objectContaining({ signer: KEY }),
    );
    expect(safeJson(result)).not.toContain(KEY);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(safeJson(call)).not.toContain(KEY);
      }
    }
  });
});

describe('ownerSafeExecutor', () => {
  it('binds the secrets so the caller only supplies the call', async () => {
    const execute = vi.fn(async () => ({
      txHash: `0x${'ee'.repeat(32)}` as Hex,
      blockNumber: 5n,
      success: true,
    }));
    const executor = ownerSafeExecutor({
      rpcUrl: 'https://arb.example',
      safeAddress: SAFE,
      privateKey: KEY,
      execute,
    });

    const result = await executor({ chainId: 42161, call: CALL });
    expect(result.blockNumber).toBe(5n);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: 42161,
        rpcUrl: 'https://arb.example',
        safeAddress: SAFE,
        privateKey: KEY,
        call: CALL,
      }),
    );
  });

  it('redacts the key from an executor error', async () => {
    const executor = ownerSafeExecutor({
      rpcUrl: 'https://arb.example',
      safeAddress: SAFE,
      privateKey: KEY,
      execute: async () => {
        throw new Error(`the SDK rejected signer ${KEY} for the Safe`);
      },
    });

    let message = '';
    try {
      await executor({ chainId: 42161, call: CALL });
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
    expect(message).toContain('[redacted]');
    expect(message).not.toContain(KEY);
  });
});
