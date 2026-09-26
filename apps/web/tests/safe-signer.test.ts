import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { SAFE_PASSKEY_MODULE } from '@kade/shared';
import { p256Verifiers, signerFactoryAddress } from '@/lib/safe/signer';

const FACTORY = signerFactoryAddress();
const VERIFIERS = p256Verifiers();

describe('p256Verifiers packing', () => {
  it('packs the Daimo fallback verifier below a zero precompile slot', () => {
    const fallback = BigInt(SAFE_PASSKEY_MODULE.p256Verifier.value);
    expect(VERIFIERS).toBe(fallback);
    // 16-bit precompile slot above a 160-bit fallback address.
    expect(VERIFIERS >> 160n).toBe(0n);
    expect(VERIFIERS & ((1n << 160n) - 1n)).toBe(fallback);
    expect(VERIFIERS).toBeLessThan(1n << 176n);
  });

  it('uses the frozen factory from @kade/shared', () => {
    expect(FACTORY).toBe(
      getAddress(SAFE_PASSKEY_MODULE.safeWebAuthnSignerFactory.value),
    );
  });
});
