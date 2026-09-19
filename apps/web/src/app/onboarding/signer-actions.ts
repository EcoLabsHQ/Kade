'use server';

import { getAddress, type Address } from 'viem';
import { SAFE_PASSKEY_MODULE } from '@kade/shared';
import { readSepoliaRpcUrl } from '@/lib/env';

/**
 * The signer address for a passkey, asked of the factory that would deploy it.
 *
 * A Safe passkey owner is not an EOA. It is a small proxy contract that
 * `SafeWebAuthnSignerFactory` deploys at an address fixed by the key's
 * coordinates, the verifier and the factory's own singleton. The factory
 * exposes `getSigner`, a view that returns that address.
 *
 * This calls the contract rather than recomputing its arithmetic locally,
 * because the address depends on the factory's immutable singleton and on the
 * proxy creation code it was compiled with. Reproducing those here would mean
 * reproducing a build, and a mismatch would silently derive an address for a
 * signer that will never exist.
 *
 * Runs on the server only: the RPC endpoint carries a provider key.
 */

const GET_SIGNER_ABI = [
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

/**
 * Pack the P-256 verifiers exactly as the module's `P256.Verifiers` expects:
 * a 16-bit EIP-7212 precompile slot above a 160-bit fallback verifier.
 *
 * The precompile slot is zero. Sepolia has no P-256 precompile, and the module
 * treats a zero slot as "no precompile" and falls through to the Solidity
 * verifier, which is what will actually check the signature.
 */
function p256Verifiers(): bigint {
  const precompile = 0n;
  const fallback = BigInt(SAFE_PASSKEY_MODULE.p256Verifier.value);
  return (precompile << 160n) | fallback;
}

export async function deriveSignerAddress(
  x: string,
  y: string,
): Promise<Address> {
  const rpcUrl = readSepoliaRpcUrl();
  if (!rpcUrl) {
    throw new Error(
      'SEPOLIA_RPC_URL is not configured, so the signer address cannot be derived.',
    );
  }

  const { createPublicClient, http } = await import('viem');
  const client = createPublicClient({ transport: http(rpcUrl) });

  const signer = await client.readContract({
    address: getAddress(SAFE_PASSKEY_MODULE.safeWebAuthnSignerFactory.value),
    abi: GET_SIGNER_ABI,
    functionName: 'getSigner',
    args: [BigInt(x), BigInt(y), p256Verifiers()],
  });

  return getAddress(signer);
}
