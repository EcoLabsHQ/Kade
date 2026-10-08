import { getAddress, type Address, type Hex } from 'viem';
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
  /** The recorded passkey signer (Safe owner) for the resident, or null. */
  readonly readOwner: (profileId: string) => Promise<Address | null>;
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
 * failure mode — an unreadable code read, no recorded owner, a refused or failed
 * deployment — is returned as `refused` with a reason, never thrown, so the mint
 * can refuse precisely.
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

  // 2. The owner is the passkey signer the address was derived from. Without it
  //    the engine cannot re-derive (and therefore cannot safely deploy) the
  //    recorded address.
  let owner: Address | null;
  try {
    owner = await deps.readOwner(input.profileId);
  } catch (cause) {
    return refused(
      account,
      `the owner of the resident Safe could not be read: ${describe(cause)}`,
    );
  }
  if (owner === null) {
    return refused(
      account,
      `the resident Safe has no recorded owner, so it cannot be deployed.`,
    );
  }

  // 3. Deploy with the existing engine. It re-derives the address from the
  //    frozen inputs and the factory's own creation code, simulates the create,
  //    and verifies code + ownership on chain before reporting success.
  let result: SafeDeployResult;
  try {
    result = await deps.deploy({
      userId: input.profileId,
      signerAddress: getAddress(owner),
      expectedSafeAddress: account,
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
