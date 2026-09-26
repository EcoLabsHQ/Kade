import { getAddress, type Address } from 'viem';
import { SAFE_PASSKEY_MODULE } from '@kade/shared';

/**
 * The Safe WebAuthn signer address, as the deployed factory derives it.
 *
 * A resident Safe's only owner is named by the `SafeWebAuthnSignerFactory`
 * rather than being an EOA: `getSigner` is deterministic in the credential's
 * P-256 coordinates and the verifier configuration, so the signer address can be
 * read before any contract exists. `signerFactoryAddress` fixes the factory that
 * does that work.
 *
 * The candidate adopted Safe's own passkey-signer model, in which Safe verifies
 * the WebAuthn assertion itself and the passkey is the owner, so there is **no
 * signer contract to deploy**. The direct `SafeWebAuthnSigner` deployment path
 * (Week 2 EXE-011) was abandoned and removed; this module no longer builds,
 * simulates or sends any `createSigner` transaction.
 *
 * `p256Verifiers()` lives here so the signer derivation cannot disagree with
 * itself about which verifier the Safe owner commits to.
 */

/**
 * `SafeWebAuthnSignerFactory` v0.2.1 (safe-modules passkey).
 *
 * Source: `modules/passkey/contracts/SafeWebAuthnSignerFactory.sol`. The
 * functions take `P256.Verifiers` — a packed `uint176`, not a `uint256` — which
 * is why the third parameter is typed `uint176`.
 */
export const SAFE_WEBAUTHN_SIGNER_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getSigner',
    stateMutability: 'view',
    inputs: [
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
      { name: 'verifiers', type: 'uint176' },
    ],
    outputs: [{ name: 'signer', type: 'address' }],
  },
] as const;

/** The deployed signer factory the Safe owner is derived through. */
export function signerFactoryAddress(): Address {
  return getAddress(SAFE_PASSKEY_MODULE.safeWebAuthnSignerFactory.value);
}

/**
 * Pack the P-256 verifiers exactly as the module's `P256.Verifiers` expects:
 * a 16-bit EIP-7212 precompile slot above a 160-bit fallback verifier.
 *
 * The precompile slot is zero. Sepolia has no P-256 precompile, and the module
 * treats a zero slot as "no precompile" and falls through to the Solidity
 * verifier, which is what will actually check the signature. This is the one
 * place the packing is computed, so the derivation is unambiguous.
 */
export function p256Verifiers(): bigint {
  const precompile = 0n;
  const fallback = BigInt(SAFE_PASSKEY_MODULE.p256Verifier.value);
  return (precompile << 160n) | fallback;
}
