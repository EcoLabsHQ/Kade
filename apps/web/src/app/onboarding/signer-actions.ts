'use server';

import { getAddress, type Address } from 'viem';
import {
  ACTIVE_SAFE_VERSION,
  SAFE_DEPLOYMENTS,
  SAFE_PASSKEY_MODULE,
} from '@kade/shared';
import { readSepoliaRpcUrl } from '@/lib/env';
import { predictedSafeAddress } from '@/lib/safe/account';

/**
 * Derive the resident's account from their passkey, asking the chain.
 *
 * Two things cannot be reproduced locally and are therefore read from the
 * contracts that will do the work:
 *
 *   - the **signer address**, which `SafeWebAuthnSignerFactory.getSigner` fixes
 *     from the key's coordinates, the verifier and the factory's immutable
 *     singleton;
 *   - the **`SafeProxy` creation code**, which `SafeProxyFactory` embeds and
 *     which is part of the CREATE2 digest. This repository's own build of the
 *     same Safe release produces different bytes, so a locally pinned copy
 *     yields an address the factory would never deploy.
 *
 * Everything else — the Safe release's addresses, the initializer shape, the
 * salt strategy — is frozen on our side, and the CREATE2 arithmetic itself is
 * pinned by a Foundry test and cross-checked against viem.
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

const PROXY_CREATION_CODE_ABI = [
  {
    type: 'function',
    name: 'proxyCreationCode',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes' }],
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

export interface DerivedAccount {
  readonly signerAddress: Address;
  readonly safeAddress: Address;
}

export async function deriveAccount(
  x: string,
  y: string,
  userId: string,
): Promise<DerivedAccount> {
  const rpcUrl = readSepoliaRpcUrl();
  if (!rpcUrl) {
    throw new Error(
      'SEPOLIA_RPC_URL is not configured, so the account address cannot be derived.',
    );
  }

  const { createPublicClient, http } = await import('viem');
  const client = createPublicClient({ transport: http(rpcUrl) });

  const [signer, proxyCreationCode] = await Promise.all([
    client.readContract({
      address: getAddress(SAFE_PASSKEY_MODULE.safeWebAuthnSignerFactory.value),
      abi: GET_SIGNER_ABI,
      functionName: 'getSigner',
      args: [BigInt(x), BigInt(y), p256Verifiers()],
    }),
    client.readContract({
      address: getAddress(
        SAFE_DEPLOYMENTS[ACTIVE_SAFE_VERSION].safeProxyFactory.value,
      ),
      abi: PROXY_CREATION_CODE_ABI,
      functionName: 'proxyCreationCode',
    }),
  ]);

  const signerAddress = getAddress(signer);
  return {
    signerAddress,
    safeAddress: predictedSafeAddress({
      userId,
      signerAddress,
      proxyCreationCode,
    }),
  };
}
