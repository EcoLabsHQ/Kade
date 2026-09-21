'use server';

import { getAddress, keccak256, type Address } from 'viem';
import {
  ACTIVE_SAFE_VERSION,
  SAFE_DEPLOYMENTS,
} from '@kade/shared';
import { readSepoliaRpcUrl } from '@/lib/env';
import { getSessionUser } from '@/lib/supabase/server';
import {
  initializerHash,
  proxyInitCodeHash,
  safeInitializer,
  safeSalt,
} from '@/lib/safe/derive';
import { residentSaltNonce } from '@/lib/safe/account';
import { safeDeploymentStore } from '@/lib/safe/manifest';
import { deployResidentSafeFromEnv } from '@/lib/safe/deploy';
import { loadPasskeyCredential } from '@/app/account/passkey-actions';
import { deriveAccount } from '@/app/onboarding/signer-actions';

/**
 * Deploy the resident's Safe, eagerly, once their passkey exists.
 *
 * The order below is the whole point of this module and must not be reordered:
 *
 *   1. the prediction is persisted — the counterfactual address *and* every
 *      input needed to re-deploy it;
 *   2. only if that succeeded, the deployment is sent.
 *
 * If the prediction cannot be recorded we do not deploy. Funds may be sent to
 * the counterfactual address at any time; if the inputs behind it were lost, the
 * money would be unrecoverable. Deploying without a record would also leave a
 * contract on chain that nothing in this repository knows how to reproduce.
 *
 * The payer key (`SEPOLIA_DEPLOYER_PRIVATE_KEY`) is read server-side only. When
 * it is absent the engine reports `not-configured` and nothing is sent — it never
 * falls back to a fabricated account.
 *
 * Note the exposure this creates and which the register declares: any
 * authenticated resident who creates a passkey causes a transaction to be sent
 * from the payer. The address is deterministic, so a repeat is free, but the
 * first one per resident costs gas.
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

export type DeployAccountStatus =
  | 'deployed'
  | 'already-deployed'
  | 'unavailable'
  | 'failed';

export interface DeployAccountResult {
  readonly status: DeployAccountStatus;
  readonly safeAddress: string | null;
  readonly txHash?: string;
  /**
   * Diagnostic only. Never rendered: it names configuration the resident has no
   * business seeing. Logged server-side instead.
   */
  readonly detail?: string;
}

function unavailable(safeAddress: string | null, detail: string): DeployAccountResult {
  console.warn('[kade] Safe deployment unavailable:', detail);
  return { status: 'unavailable', safeAddress, detail };
}

export async function deployAccount(): Promise<DeployAccountResult> {
  const session = await getSessionUser();
  if (!session) {
    return unavailable(null, 'no authenticated session');
  }

  // The credential is read from the database rather than taken from the caller:
  // the signer must not be something the browser can name.
  const stored = await loadPasskeyCredential();
  if (!stored?.publicKey) {
    return unavailable(null, 'no stored passkey credential for this resident');
  }

  const rpcUrl = readSepoliaRpcUrl();
  if (!rpcUrl) {
    return unavailable(null, 'SEPOLIA_RPC_URL is not configured');
  }

  const deployment = SAFE_DEPLOYMENTS[ACTIVE_SAFE_VERSION];
  const factory = getAddress(deployment.safeProxyFactory.value);
  const singleton = getAddress(deployment.safeL2.value);
  const fallbackHandler = getAddress(
    deployment.compatibilityFallbackHandler.value,
  );

  let safeAddress: Address;
  let signerAddress: Address;
  let proxyCreationCode: `0x${string}`;
  try {
    const { createPublicClient, http } = await import('viem');
    const { parseP256PublicKey } = await import('@/lib/passkey/public-key');
    const client = createPublicClient({ transport: http(rpcUrl) });

    const { x, y } = parseP256PublicKey(stored.publicKey);
    const derived = await deriveAccount(x.toString(), y.toString(), session.userId);
    signerAddress = derived.signerAddress as Address;
    safeAddress = derived.safeAddress as Address;

    // The factory's own creation code, not a locally built copy: it is part of
    // the CREATE2 digest, so a local build derives an address the factory would
    // never deploy.
    proxyCreationCode = await client.readContract({
      address: factory,
      abi: PROXY_CREATION_CODE_ABI,
      functionName: 'proxyCreationCode',
    });
  } catch (cause) {
    return unavailable(null, `derivation failed: ${String(cause)}`);
  }

  const initializer = safeInitializer({
    owners: [signerAddress],
    threshold: 1,
    fallbackHandler,
  });
  const initHash = initializerHash({
    owners: [signerAddress],
    threshold: 1,
    fallbackHandler,
  });
  const saltNonce = residentSaltNonce(session.userId);

  // Record the recovery inputs *before* anything is deployed.
  try {
    const store = safeDeploymentStore();
    await store.recordPrediction({
      profileId: session.userId,
      safeAddress,
      owner: signerAddress,
      initializer,
      initializerHash: initHash,
      saltNonce: saltNonce.toString(),
      salt: safeSalt(initHash, saltNonce),
      initCodeHash: proxyInitCodeHash(proxyCreationCode, singleton),
      proxyCreationCodeHash: keccak256(proxyCreationCode),
    });
  } catch (cause) {
    return unavailable(
      safeAddress,
      `prediction could not be persisted, so nothing was deployed: ${String(cause)}`,
    );
  }

  const result = await deployResidentSafeFromEnv({
    userId: session.userId,
    signerAddress,
    expectedSafeAddress: safeAddress,
  });

  const store = safeDeploymentStore();
  if (result.status === 'deployed') {
    try {
      await store.recordDeployment({
        profileId: session.userId,
        safeAddress,
        deploymentTxHash: result.txHash,
      });
    } catch (cause) {
      // The Safe is on chain either way; the record is what lags. That is worth
      // shouting about, because the row is how the repository knows it exists.
      console.error('[kade] Safe deployed but the record failed:', cause);
    }
    return { status: 'deployed', safeAddress, txHash: result.txHash };
  }

  if (result.status === 'already-deployed') {
    return { status: 'already-deployed', safeAddress };
  }

  if (result.status !== 'not-configured') {
    try {
      await store.recordDeploymentFailure({
        profileId: session.userId,
        safeAddress,
        reason: result.status,
      });
    } catch (cause) {
      console.error('[kade] could not record the deployment failure:', cause);
    }
  }

  return unavailable(safeAddress, `deployment returned ${result.status}`);
}
