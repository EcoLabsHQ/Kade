'use server';

import { getAddress, type Address } from 'viem';
import { ACTIVE_SAFE_VERSION, SAFE_DEPLOYMENTS } from '@kade/shared';
import { readSepoliaRpcUrl } from '@/lib/env';
import { predictedSafeAddress } from '@/lib/safe/account';
import {
  SAFE_WEBAUTHN_SIGNER_FACTORY_ABI,
  p256Verifiers,
  preparePasskeySigner,
  signerFactoryAddress,
} from '@/lib/safe/signer';
import { getSessionUser } from '@/lib/supabase/server';
import { loadPasskeyCredential } from '@/app/account/passkey-actions';

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

/**
 * The outcome of preparing the signer deployment, as the caller needs it.
 *
 * `ready-to-deploy` means the transaction was built and simulated and is
 * **not sent**: the Account gate is not approved, and `preparePasskeySigner`
 * has no send path. The technical reason (which can name addresses) is logged
 * server-side rather than returned, because this result is serialised.
 */
export type PrepareSignerStatus =
  | 'ready-to-deploy'
  | 'already-deployed'
  /** The RPC endpoint is absent; nothing was simulated. */
  | 'not-configured'
  /** The factory's signer is not the Safe's owner; nothing was prepared. */
  | 'address-mismatch'
  /** The engine reached the factory but the call did not succeed. */
  | 'failed'
  /** A precondition failed (no session or no stored credential). */
  | 'unavailable';

export interface PrepareSignerResult {
  readonly status: PrepareSignerStatus;
  readonly signerAddress: string | null;
  readonly safeAddress?: string;
}

/**
 * Prepare the resident's direct Safe WebAuthn signer deployment.
 *
 * This is the createSigner call path: it reads the stored credential's P-256
 * coordinates, asks the deployed factory for the signer address, and simulates
 * `createSigner` against the factory's own code. It does **not** broadcast —
 * the deployment is an irreversible on-chain write and the Account gate is not
 * approved. A post-gate caller sends the prepared transaction.
 *
 * The credential is read from the database rather than taken from the caller,
 * so the coordinates (and therefore the signer) are not something the browser
 * can name. Runs on the server only: the RPC endpoint carries a provider key.
 */
export async function preparePasskeySignerDeployment(): Promise<PrepareSignerResult> {
  const session = await getSessionUser();
  if (!session) {
    return { status: 'unavailable', signerAddress: null };
  }

  const stored = await loadPasskeyCredential();
  if (!stored?.publicKey) {
    return { status: 'unavailable', signerAddress: null };
  }

  const rpcUrl = readSepoliaRpcUrl();
  if (!rpcUrl) {
    console.warn(
      '[kade] passkey signer preparation not-configured: SEPOLIA_RPC_URL is not set',
    );
    return { status: 'not-configured', signerAddress: null };
  }

  try {
    const { createPublicClient, http } = await import('viem');
    const { parseP256PublicKey } = await import('@/lib/passkey/public-key');
    const client = createPublicClient({ transport: http(rpcUrl) });

    const { x, y } = parseP256PublicKey(stored.publicKey);
    const derived = await deriveAccount(x.toString(), y.toString(), session.userId);
    const result = await preparePasskeySigner(
      { x, y, expectedSignerAddress: derived.signerAddress },
      { publicClient: client },
    );

    if (result.status === 'failed' || result.status === 'address-mismatch') {
      console.warn(`[kade] passkey signer ${result.status}: ${result.reason}`);
    }

    return {
      status: result.status,
      signerAddress: derived.signerAddress,
      safeAddress: derived.safeAddress,
    };
  } catch (cause) {
    console.warn(`[kade] passkey signer preparation failed: ${String(cause)}`);
    return { status: 'failed', signerAddress: null };
  }
}

