import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Address, Hex } from 'viem';
import {
  buildResidentSafeBatch,
  checkAssertionAgainstOperation,
  describeSubmitIntegrity,
  operationHashToChallenge,
  recoverAssertionChallenge,
  submitResidentSafeOperation,
  type FeeEstimatorLike,
  type Safe4337PackLike,
  type SafeAssertionParts,
  type SafeExecutionDependencies,
} from '@/lib/safe/execute-safe-4337';
import type { PasskeySigner } from '@/lib/safe/passkey-signer';

/**
 * The submit-integrity instrumentation (T36).
 *
 * The app's own gate proves the retained operation still hashes to the value
 * the passkey signed, but nothing in the repository can see the operation the
 * bundler/EntryPoint actually validated. These tests pin the offline-recoverable
 * facts that settle it on the next live `AA24`:
 *
 *   - the challenge the assertion really signed is recoverable from its
 *     `clientDataJSON`, and is compared with `base64url(getHash())`;
 *   - the assertion's raw P-256 signature is verified locally against the
 *     stored credential, independent of the bundler;
 *   - the diagnostic changes neither the submission nor its failure shape.
 *
 * The P-256 key is generated in-process; no network and no real credential.
 */

const SAFE_OP_HASH = `0x${'ab'.repeat(32)}` as Hex;
const OTHER_HASH = `0x${'cd'.repeat(32)}` as Hex;
const SIGNATURE = '0xdeadbeef' as Hex;
const SAFE = '0x1111111111111111111111111111111111111111' as Address;
const RAW_VERIFICATION_GAS = 51_698n;

const ENV = {
  PIMLICO_API_KEY: 'pim_test',
  PIMLICO_POLICY_ID: 'sp_test',
} as unknown as NodeJS.ProcessEnv;

const CALLS = [
  { to: '0xaaaa000000000000000000000000000000000001' as Address, value: 0n, data: '0xdead' as Hex },
];

const base64url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Build a real, verifiable WebAuthn assertion over a chosen challenge. */
function signedAssertion(options: { readonly challenge: string }): {
  assertion: SafeAssertionParts;
  coordinates: { x: string; y: string };
} {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };

  const authenticatorData = Uint8Array.from({ length: 37 }, (_, i) => i);
  const clientDataJSON = new TextEncoder().encode(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: options.challenge,
      origin: 'https://localhost',
      crossOrigin: false,
    }),
  );
  const clientHash = createHash('sha256').update(clientDataJSON).digest();
  const message = Buffer.concat([Buffer.from(authenticatorData), clientHash]);
  const der = sign('sha256', message, { key: privateKey, dsaEncoding: 'der' });

  const decimal = (value: string): string => BigInt(`0x${Buffer.from(value, 'base64url').toString('hex')}`).toString();

  return {
    assertion: {
      authenticatorData: base64url(authenticatorData),
      signature: base64url(new Uint8Array(der)),
      clientDataJSON: base64url(clientDataJSON),
    },
    coordinates: { x: decimal(jwk.x), y: decimal(jwk.y) },
  };
}

describe('recoverAssertionChallenge', () => {
  it('returns the challenge the assertion signed', () => {
    const { assertion } = signedAssertion({ challenge: 'abc' });
    expect(recoverAssertionChallenge(assertion)).toBe('abc');
  });

  it('returns null for a malformed clientDataJSON without throwing', () => {
    expect(
      recoverAssertionChallenge({
        authenticatorData: base64url(Uint8Array.from([1])),
        signature: base64url(Uint8Array.from([2])),
        clientDataJSON: base64url(new TextEncoder().encode('not json')),
      }),
    ).toBeNull();
    expect(
      recoverAssertionChallenge({
        authenticatorData: 'not-base64url!!',
        signature: 'x',
        clientDataJSON: 'x',
      }),
    ).toBeNull();
  });
});

describe('operationHashToChallenge', () => {
  it('is base64url, unpadded, 43 chars — the WebAuthn challenge form', () => {
    const challenge = operationHashToChallenge(SAFE_OP_HASH);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(base64url(Buffer.from('ab'.repeat(32), 'hex')));
  });
});

describe('checkAssertionAgainstOperation', () => {
  it('accepts an assertion that signs and verifies over the operation hash', () => {
    const hash = SAFE_OP_HASH;
    const { assertion, coordinates } = signedAssertion({
      challenge: operationHashToChallenge(hash),
    });

    const check = checkAssertionAgainstOperation(assertion, hash, coordinates);

    expect(check.expectedChallenge).toBe(operationHashToChallenge(hash));
    expect(check.assertionChallenge).toBe(check.expectedChallenge);
    expect(check.challengeMatches).toBe(true);
    expect(check.signatureValid).toBe(true);
  });

  it('reports a challenge that does not match the operation hash', () => {
    const { assertion, coordinates } = signedAssertion({
      challenge: operationHashToChallenge(OTHER_HASH),
    });

    const check = checkAssertionAgainstOperation(assertion, SAFE_OP_HASH, coordinates);

    expect(check.challengeMatches).toBe(false);
    // The signature is still a valid signature over the message it was made
    // over; only the challenge comparison ties it to this operation.
    expect(check.signatureValid).toBe(true);
  });

  it('reports a tampered signature as invalid', () => {
    const hash = SAFE_OP_HASH;
    const { assertion, coordinates } = signedAssertion({
      challenge: operationHashToChallenge(hash),
    });
    const tampered: SafeAssertionParts = {
      ...assertion,
      signature: base64url(Uint8Array.from(Buffer.from(assertion.signature, 'base64url').fill(0x00))),
    };

    const check = checkAssertionAgainstOperation(tampered, hash, coordinates);

    expect(check.challengeMatches).toBe(true);
    expect(check.signatureValid).toBe(false);
  });

  it('leaves the signature check null when the coordinates are unreadable', () => {
    const { assertion } = signedAssertion({
      challenge: operationHashToChallenge(SAFE_OP_HASH),
    });
    const check = checkAssertionAgainstOperation(assertion, SAFE_OP_HASH, { x: 'not-a-number', y: '2' });
    expect(check.signatureValid).toBeNull();
  });
});

describe('describeSubmitIntegrity', () => {
  it('captures the signed hash, the assertion challenge and the serialized operation', () => {
    const hash = SAFE_OP_HASH;
    const { assertion, coordinates } = signedAssertion({
      challenge: operationHashToChallenge(hash),
    });
    const signed = {
      encodedSignatures: () => SIGNATURE,
      getUserOperation: () => ({
        sender: SAFE,
        nonce: '1',
        callGasLimit: 509_922n,
        verifyingContract: undefined,
        signature: '0xdeadbeef',
      }),
    };

    const diagnostic = describeSubmitIntegrity(hash, signed, assertion, coordinates);

    expect(diagnostic.signedHash).toBe(hash);
    expect(diagnostic.challengeMatches).toBe(true);
    expect(diagnostic.signatureValid).toBe(true);
    // The signature bytes are never carried; only the length is recorded.
    expect(diagnostic.operation).not.toHaveProperty('signature');
    expect(diagnostic.operation?.signatureLength).toBe(10);
    expect(diagnostic.operation?.callGasLimit).toBe('0x7c7e2');
    expect(diagnostic.operation?.verifyingContract).toBeNull();
  });
});

describe('submitResidentSafeOperation instrumentation', () => {
  /**
   * A pack whose only job is to reach the submit stage: the build phase buffers
   * the estimate, and submit rejects at `executeTransaction` exactly as a
   * bundler's `AA24` does.
   */
  function rejectingPack(): { deps: SafeExecutionDependencies; retained: unknown } {
    const gas = { value: RAW_VERIFICATION_GAS };
    const retained = {
      getUserOperation: () => ({ verificationGasLimit: gas.value }),
      addEstimations: (estimations: { verificationGasLimit?: bigint }) => {
        if (estimations.verificationGasLimit) gas.value = estimations.verificationGasLimit;
      },
      getHash: () => SAFE_OP_HASH,
    };
    const signed = {
      encodedSignatures: () => SIGNATURE,
      getUserOperation: () => ({ sender: SAFE, nonce: '1', verificationGasLimit: gas.value, signature: '0xbeef' }),
    };
    const pack = {
      createTransaction: vi.fn(async (input: { options?: { feeEstimator?: FeeEstimatorLike } }) => {
        const data = await input.options?.feeEstimator?.postEstimateUserOperationGas?.({
          userOperation: { ...retained.getUserOperation(), signature: '0xdummy' as Hex },
        });
        if (data) retained.addEstimations(data);
        return retained;
      }),
      signSafeOperation: vi.fn(async () => signed),
      executeTransaction: vi.fn(async () => {
        throw new Error('UserOperation reverted with reason: AA24 signature error');
      }),
      getUserOperationReceipt: vi.fn(async () => null),
    } as unknown as Safe4337PackLike;
    const deps: SafeExecutionDependencies = {
      initPack: vi.fn(async () => pack),
      signer: {
        rawId: 'cred-1',
        coordinates: { x: '1', y: '2' },
        verifierAddress: '0x4444444444444444444444444444444444444444',
      } satisfies PasskeySigner,
      safeAddress: SAFE,
    };
    return { deps, retained };
  }

  it('logs a secret-free diagnostic and keeps the fail-closed refusal unchanged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { deps } = rejectingPack();

    const built = await buildResidentSafeBatch(CALLS, deps, ENV);
    expect(built.status).toBe('built');
    if (built.status !== 'built') return;

    const assertion: SafeAssertionParts = {
      authenticatorData: base64url(Uint8Array.from([1, 2, 3])),
      signature: base64url(Uint8Array.from([48, 6, 2, 1, 1, 2, 1, 2])),
      clientDataJSON: base64url(new TextEncoder().encode('{"type":"webauthn.get","challenge":"x"}')),
    };

    const outcome = await submitResidentSafeOperation(
      { token: built.token, assertion },
      deps,
      ENV,
    );

    // The refusal is exactly as before: never `sent`, names the submit stage.
    expect(outcome.status).toBe('failed');
    if (outcome.status !== 'failed') return;
    expect(outcome.sent).toBe(false);
    expect(outcome.stage).toBe('submit');
    expect(outcome.reason).toMatch(/AA24/);
    expect(warn).toHaveBeenCalledTimes(1);

    const line = warn.mock.calls[0]?.join(' ') ?? '';
    expect(line).toContain('submit-integrity diagnostic');
    expect(line).toContain('AA24');
    // The signed hash is on the wire, but the assertion's signature bytes are not.
    expect(line).toContain(SAFE_OP_HASH);
    expect(line).not.toContain(assertion.signature);

    warn.mockRestore();
  });
});
