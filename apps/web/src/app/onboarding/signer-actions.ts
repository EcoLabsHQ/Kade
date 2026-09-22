'use server';

import { getAddress, type Address } from 'viem';
import { ACTIVE_SAFE_VERSION, SAFE_DEPLOYMENTS } from '@kade/shared';
import { readSepoliaRpcUrl } from '@/lib/env';
import { predictedSafeAddress } from '@/lib/safe/account';
import {
  SAFE_WEBAUTHN_SIGNER_FACTORY_ABI,
  p256Verifiers,
  signerFactoryAddress,
} from '@/lib/safe/signer';

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

const PROXY_CREATION_CODE_ABI = [
  {
    type: 'function',
    name: 'proxyCreationCode',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const;

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
      address: signerFactoryAddress(),
      abi: SAFE_WEBAUTHN_SIGNER_FACTORY_ABI,
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

