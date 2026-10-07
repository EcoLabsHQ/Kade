import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  ownerSafeMessageSigner,
  signSafeOwnerMessage,
  type SafeMessageSigningDependencies,
} from '@/lib/safe/owner-sign-message';
import { buildSnapshotVoteTypedData } from '@/lib/vote/snapshot';

/**
 * Signing an EIP-712 message through an owner Safe.
 *
 * The properties under test: the wrapped message is the exact typed data, the
 * Safe's own EIP-712 signature is produced with `signTypedData` (v4) and added
 * to the Safe message, the returned value is the Safe's encoded signatures; a
 * signer that is not a Safe owner is refused before anything is signed; a
 * malformed key is refused; and the private key never appears in the result or a
 * log.
 */

const KEY = `0x${'11'.repeat(32)}` as Hex;
const SIGNER = getAddress(privateKeyToAccount(KEY).address);
const SAFE = '0x3333333333333333333333333333333333333333' as Address;
const ENCODED = `0x${'ab'.repeat(65)}` as Hex;
const MESSAGE = buildSnapshotVoteTypedData({
  from: SAFE,
  space: 'kadeglobal.eth',
  proposal: '0xproposal',
  choice: 1,
  timestamp: 1_791_382_034,
});

interface Captured {
  readonly created: unknown[];
  readonly signed: Array<{ message: unknown; version: string | undefined }>;
  readonly added: unknown[];
}

function captured(): Captured {
  return { created: [], signed: [], added: [] };
}

function fakeDeps(options: {
  owners?: readonly string[];
  encoded?: string;
  captured?: Captured;
}): SafeMessageSigningDependencies {
  return {
    async initSafe() {
      return {
        async getOwners() {
          return options.owners ?? [SIGNER];
        },
        createMessage(message) {
          options.captured?.created.push(message);
          return {
            addSignature(signature) {
              options.captured?.added.push(signature);
            },
            encodedSignatures() {
              return options.encoded ?? ENCODED;
            },
          };
        },
        async signTypedData(message, version) {
          options.captured?.signed.push({ message, version });
          return { signature: '0xfake' };
        },
      };
    },
    hashTypedData() {
      return `0x${'cd'.repeat(32)}` as Hex;
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

describe('signSafeOwnerMessage', () => {
  it('wraps the typed data, signs the Safe message and returns the encoded signatures', async () => {
    const seen = captured();
    const result = await signSafeOwnerMessage(
      {
        chainId: 42161,
        rpcUrl: 'https://arb.example',
        safeAddress: SAFE,
        privateKey: KEY,
        message: MESSAGE,
      },
      fakeDeps({ captured: seen }),
    );

    expect(result.signature).toBe(ENCODED);
    expect(result.signer).toBe(SIGNER);
    expect(result.messageHash).toBe(`0x${'cd'.repeat(32)}`);
    // The Safe message wraps the caller's exact typed data.
    expect(seen.created).toEqual([MESSAGE]);
    // The owner signature is EIP-712 v4 over the Safe message.
    expect(seen.signed).toHaveLength(1);
    expect(seen.signed[0]?.version).toBe('v4');
    expect(seen.signed[0]?.message).toBeTypeOf('object');
    // The signature produced is the one added to the Safe message.
    expect(seen.added).toEqual([{ signature: '0xfake' }]);
  });

  it('refuses a signer that is not an owner of the Safe, before signing', async () => {
    const seen = captured();
    await expect(
      signSafeOwnerMessage(
        {
          chainId: 42161,
          rpcUrl: 'https://arb.example',
          safeAddress: SAFE,
          privateKey: KEY,
          message: MESSAGE,
        },
        fakeDeps({ owners: ['0x9999999999999999999999999999999999999999'], captured: seen }),
      ),
    ).rejects.toThrow(/not an owner/i);
    expect(seen.created).toHaveLength(0);
    expect(seen.signed).toHaveLength(0);
  });

  it('refuses a malformed key before initialising anything', async () => {
    const initSafe = vi.fn();
    await expect(
      signSafeOwnerMessage(
        {
          chainId: 42161,
          rpcUrl: 'https://arb.example',
          safeAddress: SAFE,
          privateKey: 'nope',
          message: MESSAGE,
        },
        { initSafe, hashTypedData: () => `0x${'cd'.repeat(32)}` as Hex },
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
    const result = await signSafeOwnerMessage(
      {
        chainId: 42161,
        rpcUrl: 'https://arb.example',
        safeAddress: SAFE,
        privateKey: KEY,
        message: MESSAGE,
      },
      fakeDeps({}),
    );

    expect(safeJson(result)).not.toContain(KEY);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(safeJson(call)).not.toContain(KEY);
      }
    }
  });
});

describe('ownerSafeMessageSigner', () => {
  it('binds the secrets so the caller only supplies the message', async () => {
    const sign = vi.fn(async () => ({
      signature: ENCODED,
      messageHash: `0x${'cd'.repeat(32)}` as Hex,
      signer: SIGNER,
    }));
    const bound = ownerSafeMessageSigner({
      rpcUrl: 'https://arb.example',
      safeAddress: SAFE,
      privateKey: KEY,
      sign,
    });

    const result = await bound({ chainId: 42161, message: MESSAGE });
    expect(result.signature).toBe(ENCODED);
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        chainId: 42161,
        rpcUrl: 'https://arb.example',
        safeAddress: SAFE,
        privateKey: KEY,
        message: MESSAGE,
      }),
    );
  });

  it('redacts the key from a signer error', async () => {
    const bound = ownerSafeMessageSigner({
      rpcUrl: 'https://arb.example',
      safeAddress: SAFE,
      privateKey: KEY,
      sign: async () => {
        throw new Error(`the SDK rejected signer ${KEY} for the Safe`);
      },
    });

    let message = '';
    try {
      await bound({ chainId: 42161, message: MESSAGE });
    } catch (cause) {
      message = cause instanceof Error ? cause.message : String(cause);
    }
    expect(message).toContain('[redacted]');
    expect(message).not.toContain(KEY);
  });
});
