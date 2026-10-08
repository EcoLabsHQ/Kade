import { describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import {
  PASSKEY_MESSAGE_SIGNING_METHOD,
  signSafeMessageWithPasskey,
  type PasskeyMessageSigningDependencies,
  type SafeMessageProtocolKit,
} from '@/lib/safe/passkey-sign-message';

/**
 * Signing a Safe message with the resident's passkey.
 *
 * The passkey lives in the browser, so this module drives the Safe SDK's message
 * API there. These tests inject the SDK seam, so no chain, no passkey prompt and
 * no network is reached; they prove the exact calls the SDK's documented message
 * guide makes:
 *
 *   initSafe({ provider, signer, safeAddress })
 *     → createMessage(typedData)
 *     → signMessage(safeMessage, SigningMethod.ETH_SIGN)
 *     → encodedSignatures()
 *
 * `ETH_SIGN` (`'eth_sign'`) is the method that works with a passkey owner: the
 * default typed-data method refuses passkeys. Only the resulting Safe signature
 * is returned; no credential material crosses the seam.
 */

const SAFE = '0x2222222222222222222222222222222222222222' as Address;
const SIGNATURE = `0x${'cd'.repeat(80)}` as Hex;

const TYPED_DATA = {
  domain: { name: 'snapshot', version: '0.1.4' },
  types: { Vote: [{ name: 'from', type: 'string' }] },
  primaryType: 'Vote',
  message: { from: SAFE },
};

const SIGNER = {
  rawId: 'aabbcc',
  coordinates: { x: '1', y: '2' },
  verifierAddress: '0x3333333333333333333333333333333333333333',
};

interface Harness {
  readonly deps: PasskeyMessageSigningDependencies;
  readonly initSafe: ReturnType<typeof vi.fn>;
  readonly createMessage: ReturnType<typeof vi.fn>;
  readonly signMessage: ReturnType<typeof vi.fn>;
}

function harness(encoded: string = SIGNATURE): Harness {
  const createMessage = vi.fn(() => ({ kind: 'safe-message' }));
  const signMessage = vi.fn(async () => ({
    encodedSignatures: () => encoded,
  }));
  const protocolKit: SafeMessageProtocolKit = {
    createMessage,
    signMessage,
  };
  const initSafe = vi.fn(async () => protocolKit);
  return {
    deps: { initSafe, signingMethod: PASSKEY_MESSAGE_SIGNING_METHOD },
    initSafe,
    createMessage,
    signMessage,
  };
}

describe('signSafeMessageWithPasskey', () => {
  it('drives the Safe SDK message API with ETH_SIGN and returns encodedSignatures', async () => {
    const { deps, initSafe, createMessage, signMessage } = harness();

    const signature = await signSafeMessageWithPasskey(
      {
        rpcUrl: 'https://arb.example',
        safeAddress: SAFE,
        signer: SIGNER,
        message: TYPED_DATA,
      },
      deps,
    );

    expect(signature).toBe(SIGNATURE);
    expect(initSafe).toHaveBeenCalledWith({
      provider: 'https://arb.example',
      signer: SIGNER,
      safeAddress: SAFE,
    });
    expect(createMessage).toHaveBeenCalledWith(TYPED_DATA);
    // The passkey-compatible method, not the default typed-data method that the
    // SDK refuses for passkeys.
    expect(signMessage).toHaveBeenCalledWith({ kind: 'safe-message' }, 'eth_sign');
  });

  it('refuses an empty SDK signature instead of returning it as signed', async () => {
    const { deps } = harness('0x');
    await expect(
      signSafeMessageWithPasskey(
        {
          rpcUrl: 'https://arb.example',
          safeAddress: SAFE,
          signer: SIGNER,
          message: TYPED_DATA,
        },
        deps,
      ),
    ).rejects.toThrow(/no message signature/i);
  });

  it('returns only the signature — no passkey material is serialised', async () => {
    const { deps } = harness();
    const result = await signSafeMessageWithPasskey(
      {
        rpcUrl: 'https://arb.example',
        safeAddress: SAFE,
        signer: SIGNER,
        message: TYPED_DATA,
      },
      deps,
    );

    expect(typeof result).toBe('string');
    expect(result).not.toContain(SIGNER.rawId);
    expect(result).not.toContain(SIGNER.coordinates.x);
    expect(result).not.toContain(SIGNER.verifierAddress);
  });
});
