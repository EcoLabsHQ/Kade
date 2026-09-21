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
 * A failed attempt is safe to repeat: the address is deterministic and the
 * engine is idempotent, so calling this again never creates a second passkey or
 * a second Safe. The returned status names the failure mode (so the resident can
 * act on it) while the diagnostic stays in the server log.
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

/**
 * The outcome of a deployment attempt, as the resident's screen needs it.
 *
 * Each failure mode is its own status rather than one opaque "unavailable", so
 * the UI can say something true and specific and offer a retry. The technical
 * explanation — which can name configuration and addresses — never crosses this
 * boundary: it is logged server-side. The returned object is serialised to the
 * browser, so it carries no `detail`.
 */
export type DeployAccountStatus =
  | 'deployed'
  | 'already-deployed'
  /** The payer key or the RPC endpoint is absent; nothing was sent. */
  | 'not-configured'
  /** The payer could not cover the estimated gas; nothing was sent. */
  | 'insufficient-funds'
  /** The frozen inputs no longer derive the recorded address; nothing was sent. */
  | 'address-mismatch'
  /** The engine reached the chain but the deployment did not succeed. */
  | 'failed'
  /** A precondition failed before the engine ran (no session or credential). */
  | 'unavailable';

export interface DeployAccountResult {
  readonly status: DeployAccountStatus;
  readonly safeAddress: string | null;
  readonly txHash?: string;
}

/**
 * Log the diagnostic and return the resident-facing result.
 *
 * `detail` is deliberately not part of the returned value: the result is
 * serialised to the browser, and the detail names configuration the resident has
 * no business seeing. The log line is where a deployment is diagnosed.
 */
function outcome(
  status: DeployAccountStatus,
  safeAddress: string | null,
  detail: string,
  extra: { readonly txHash?: string } = {},
): DeployAccountResult {
  if (status !== 'deployed' && status !== 'already-deployed') {
    const where = safeAddress ? ` for ${safeAddress}` : '';
    console.warn(`[kade] Safe deployment ${status}${where}: ${detail}`);
  }
  return { status, safeAddress, ...extra };
}

/** Record a failure on an already-predicted row, without letting that mask it. */
async function recordFailure(
  store: ReturnType<typeof safeDeploymentStore>,
  profileId: string,
  safeAddress: Address,
  reason: string,
): Promise<void> {
  try {
    await store.recordDeploymentFailure({ profileId, safeAddress, reason });
  } catch (cause) {
    console.error('[kade] could not record the deployment failure:', cause);
  }
}

export async function deployAccount(): Promise<DeployAccountResult> {
  const session = await getSessionUser();
  if (!session) {
    return outcome('unavailable', null, 'no authenticated session');
  }

  // The credential is read from the database rather than taken from the caller:
  // the signer must not be something the browser can name.
  const stored = await loadPasskeyCredential();
  if (!stored?.publicKey) {
    return outcome('unavailable', null, 'no stored passkey credential for this resident');
  }

  const rpcUrl = readSepoliaRpcUrl();
  if (!rpcUrl) {
    return outcome('not-configured', null, 'SEPOLIA_RPC_URL is not configured');
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
    return outcome('failed', null, `derivation failed: ${String(cause)}`);
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

  let store: ReturnType<typeof safeDeploymentStore>;
  try {
    store = safeDeploymentStore();
  } catch (cause) {
    return outcome(
      'unavailable',
      safeAddress,
      `the deployment record store is unavailable: ${String(cause)}`,
    );
  }

  // Record the recovery inputs *before* anything is deployed. This ordering is
  // the whole point of the module and must not be reordered: if the prediction
  // cannot be persisted, nothing is sent.
  try {
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
    return outcome(
      'failed',
      safeAddress,
      `prediction could not be persisted, so nothing was deployed: ${String(cause)}`,
    );
  }

  const result = await deployResidentSafeFromEnv({
    userId: session.userId,
    signerAddress,
    expectedSafeAddress: safeAddress,
  });

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
    // The contract is on chain. Reconcile the record so the shell shows it as
    // deployed even if a previous success never made it into the row. There is
    // no hash to add here; a null leaves any recorded hash untouched.
    try {
      await store.recordDeployment({
        profileId: session.userId,
        safeAddress,
        deploymentTxHash: null,
      });
    } catch (cause) {
      console.error('[kade] could not record the already-deployed Safe:', cause);
    }
    return { status: 'already-deployed', safeAddress };
  }

  if (result.status === 'not-configured') {
    // Nothing was sent, so there is no deployment failure to record. The
    // resident can retry once the payer is configured.
    return outcome('not-configured', safeAddress, result.reason);
  }

  if (result.status === 'insufficient-funds') {
    const detail =
      `the payer ${result.payer} holds ${result.available} wei but the ` +
      `deployment needs ${result.required} wei`;
    await recordFailure(store, session.userId, safeAddress, `insufficient funds: ${detail}`);
    return outcome('insufficient-funds', safeAddress, detail);
  }

  if (result.status === 'address-mismatch') {
    await recordFailure(store, session.userId, safeAddress, `address mismatch: ${result.reason}`);
    return outcome('address-mismatch', safeAddress, result.reason);
  }

  // result.status === 'failed'
  await recordFailure(
    store,
    session.userId,
    safeAddress,
    `failed at ${result.stage}: ${result.reason}`,
  );
  return outcome('failed', safeAddress, `the engine failed at ${result.stage}: ${result.reason}`);
}
