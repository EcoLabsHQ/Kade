import { getAddress, type Address, type Hex } from 'viem';
import type { PasskeySigner } from '@/lib/safe/passkey-signer';
import type { DerivedAccount } from '@/lib/safe/derive-account';
import { deploymentInputsFromPredicted } from '@/lib/safe/predicted-safe';
import type { SafeDeployRequest, SafeDeployResult } from './deploy';

/**
 * Ensure the resident's Safe is a **deployed contract** on the chain the
 * credential is minted on, before the mint is allowed to proceed.
 *
 * The resident Safe address is counterfactual and identical on every chain: the
 * same passkey derives the same address, but the `SafeProxy` only exists where
 * it has actually been deployed. A credential minted to that address on a chain
 * where no code exists is a credential nobody can control, and a `Snapshot`
 * vote can never verify it (`isValidSignature` has no contract to answer).
 *
 * This module closes that gap with the one check that can tell the truth: the
 * chain's own bytecode at the address, read with viem's `getBytecode` (the
 * `cast code` / `eth_getCode` equivalent). A recorded address in
 * `safe_deployments` is **not** evidence of a deployed contract, so it is never
 * consulted here; only on-chain code counts.
 *
 * When the address has no code, the Safe is deployed with the repository's
 * existing engine (`./deploy`), through the injected `deploy` seam. This module
 * never constructs a signer, a client or a key: the caller owns the environment
 * wiring, exactly as `deployResidentSafeFromEnv` does. Nothing here broadcasts
 * on its own, so a test can prove every branch with injected fakes and no
 * network.
 */

/**
 * The outcome of the readiness check.
 *
 * `deployed` asserts only that the address had code on chain (or was brought to
 * that state by `deploy`). `deployedNow` distinguishes a Safe that already
 * existed from one this call created, so the caller can report which happened.
 * `refused` means no code is present and none could be created; the mint must
 * not proceed.
 */
export type SafeReadinessOutcome =
  | {
      readonly status: 'deployed';
      readonly safeAddress: Address;
      /** The deployment transaction, or null when the Safe was already on chain. */
      readonly txHash: Hex | null;
      /** True when this call sent the deployment; false when code already existed. */
      readonly deployedNow: boolean;
    }
  | {
      readonly status: 'refused';
      readonly safeAddress: Address;
      /** A precise, operator-readable reason the Safe is not deployed. */
      readonly reason: string;
    };

/**
 * The code-read surface this module needs. viem's `PublicClient.getBytecode`
 * satisfies it directly.
 */
export interface SafeCodeClient {
  getBytecode(args: { readonly address: Address }): Promise<Hex | undefined>;
}

export interface EnsureSafeDeployedDependencies {
  /** Reads the chain's bytecode at the resident Safe address. */
  readonly codeClient: SafeCodeClient;
  /**
   * The resident's passkey signer, or null when none is recorded. It is the one
   * input the address was derived from, so the guard derives through the same
   * path onboarding used rather than a second, disagreeing implementation.
   */
  readonly readSigner: (profileId: string) => Promise<PasskeySigner | null>;
  /**
   * The onboarding derivation (Safe's SDK). Injected so the guard proves its
   * branch offline and so the address can never be re-derived by a different
   * implementation than the one that recorded it.
   */
  readonly derive: (signer: PasskeySigner, chainId: number) => Promise<DerivedAccount>;
  /** The existing deployment engine, bound to the membership chain. */
  readonly deploy: (request: SafeDeployRequest) => Promise<SafeDeployResult>;
}

/**
 * The mint-facing seam: it carries no client, key or RPC, so the mint module
 * never reaches a chain itself. `null` when the environment cannot check or
 * deploy, which the mint treats as a refusal.
 */
export type SafeDeploymentGuard = (input: {
  readonly profileId: string;
  readonly account: Address;
  readonly chainId: number;
}) => Promise<SafeReadinessOutcome>;

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function refused(safeAddress: Address, reason: string): SafeReadinessOutcome {
  console.error(`[kade] refusing to mint to an undeployed Safe: ${reason}`);
  return { status: 'refused', safeAddress, reason };
}

/** Whether a bytecode read reports a contract (non-empty code). */
function hasCode(code: Hex | undefined): boolean {
  return code !== undefined && code !== '0x';
}

/** Case-insensitive address equality. */
function sameAccount(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The precise reason a `deployResidentSafe` result did not produce a contract.
 * `deployed` and `already-deployed` are successes and are never passed here.
 */
function deploymentRefusalReason(
  result: Exclude<SafeDeployResult, { status: 'deployed' | 'already-deployed' }>,
): string {
  switch (result.status) {
    case 'not-configured':
      return `the deployment engine is not configured: ${result.reason}`;
    case 'insufficient-funds':
      return (
        `the deployment payer ${result.payer} holds ${result.available} wei but the ` +
        `deployment needs ${result.required} wei`
      );
    case 'address-mismatch':
      return (
        `the deployment inputs do not derive the recorded Safe address ` +
        `${result.safeAddress}: ${result.reason}`
      );
    case 'failed':
      return `the deployment failed at ${result.stage}: ${result.reason}`;
  }
}

/**
 * Confirm the resident Safe has code on `input.chainId`, deploying it first
 * with the injected engine when it does not.
 *
 * The order is deliberate: the on-chain code read is the first and the last
 * thing checked, so a `deployed` outcome always means code was observed at the
 * address (either before the call, or after the engine reported success). Every
 * failure mode — an unreadable code read, no recorded passkey, a derivation that
 * disagrees with the record, a refused or failed deployment — is returned as
 * `refused` with a reason, never thrown, so the mint can refuse precisely.
 */
export async function ensureResidentSafeDeployed(
  input: {
    readonly profileId: string;
    readonly account: Address;
    readonly chainId: number;
  },
  deps: EnsureSafeDeployedDependencies,
): Promise<SafeReadinessOutcome> {
  const account = getAddress(input.account);

  // 1. The real check: does the address have code on this chain? A recorded
  //    address is not consulted, because it says nothing about this chain.
  let code: Hex | undefined;
  try {
    code = await deps.codeClient.getBytecode({ address: account });
  } catch (cause) {
    return refused(
      account,
      `the code at ${account} could not be read on chain ${input.chainId}: ${describe(cause)}`,
    );
  }
  if (hasCode(code)) {
    return {
      status: 'deployed',
      safeAddress: account,
      txHash: null,
      deployedNow: false,
    };
  }

  // 2. Re-derive the account from the resident's passkey, through the **same**
  //    path onboarding used. The address is chain-independent by construction, so
  //    the derivation must equal the recorded address before anything is built;
  //    a disagreement is a refusal, never a second Safe.
  let signer: PasskeySigner | null;
  try {
    signer = await deps.readSigner(input.profileId);
  } catch (cause) {
    return refused(
      account,
      `the passkey for the resident Safe could not be read: ${describe(cause)}`,
    );
  }
  if (signer === null) {
    return refused(
      account,
      `the resident Safe has no recorded passkey, so its address cannot be ` +
        're-derived and it cannot be deployed.',
    );
  }

  let derived: DerivedAccount;
  try {
    derived = await deps.derive(signer, input.chainId);
  } catch (cause) {
    return refused(
      account,
      `the resident Safe could not be derived on chain ${input.chainId}: ${describe(cause)}`,
    );
  }
  if (!sameAccount(derived.safeAddress, account)) {
    return refused(
      account,
      `the passkey derives ${derived.safeAddress} on chain ${input.chainId}, not the ` +
        `recorded ${account}. Deploying would create a Safe the resident does not control.`,
    );
  }
  if (derived.predicted === undefined) {
    return refused(
      account,
      'the account\'s own predicted deployment is unavailable, so the recorded ' +
        'address cannot be reproduced for deployment.',
    );
  }

  // 3. Deploy with the existing engine, handing it the account's own predicted
  //    inputs. It re-derives the address from them and the factory's own creation
  //    code, simulates the create, and verifies code + ownership on chain before
  //    reporting success — so a wrong input still refuses.
  const deployment = deploymentInputsFromPredicted(derived.predicted);
  let result: SafeDeployResult;
  try {
    result = await deps.deploy({
      userId: input.profileId,
      signerAddress: deployment.owners[0],
      expectedSafeAddress: account,
      deployment,
    });
  } catch (cause) {
    return refused(
      account,
      `the Safe deployment could not be attempted: ${describe(cause)}`,
    );
  }

  if (result.status !== 'deployed' && result.status !== 'already-deployed') {
    return refused(account, deploymentRefusalReason(result));
  }

  // 4. Prove code is present before allowing the mint, even though the engine
  //    already verified it: the readiness contract is "code observed", and this
  //    keeps that true independently of the engine's internals.
  let finalCode: Hex | undefined;
  try {
    finalCode = await deps.codeClient.getBytecode({ address: account });
  } catch (cause) {
    return refused(
      account,
      `the code at ${account} could not be read after deployment: ${describe(cause)}`,
    );
  }
  if (!hasCode(finalCode)) {
    return refused(
      account,
      `the deployment reported success but ${account} still has no code on chain ${input.chainId}.`,
    );
  }

  return {
    status: 'deployed',
    safeAddress: account,
    txHash: result.status === 'deployed' ? result.txHash : null,
    deployedNow: result.status === 'deployed',
  };
}
