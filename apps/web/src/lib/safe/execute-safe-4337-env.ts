import { CHAIN_IDS } from '@kade/shared';
import type { Address } from 'viem';
import {
  executeResidentSafeBatch,
  pimlicoUrl,
  readPimlicoConfig,
  type Safe4337PackLike,
  type SafeCall,
  type SafeExecutionDependencies,
  type SafeExecutionOutcome,
} from './execute-safe-4337';
import type { PasskeySigner } from './passkey-signer';

/**
 * The Pimlico-backed `Safe4337Pack.init`, following Safe's documented guide.
 *
 *   Safe4337Pack.init({
 *     provider, signer: passkeySigner, bundlerUrl,
 *     paymasterOptions: { isSponsored: true, paymasterUrl },
 *     options: safeAddress ? { safeAddress } : { owners: [owner], threshold: 1 },
 *   })
 *
 * Two details that matter and come from the guide rather than from guesswork:
 *
 *   - the `signer` is the **passkey object**, not an address;
 *   - when there is no Safe yet, `options` describes one to **create**, and the
 *     first user operation deploys it. Nothing is deployed in advance.
 */
export async function initSafe4337Pack(input: {
  readonly chainId: number;
  readonly signer: PasskeySigner;
  readonly safeAddress: Address | null;
  readonly bundlerUrl: string;
}): Promise<Safe4337PackLike> {
  const { Safe4337Pack } = await import('@safe-global/relay-kit');

  const pack = await Safe4337Pack.init({
    provider: rpcUrlFor(input.chainId),
    // The passkey is the owner, so it is passed whole — not as an address.
    signer: input.signer as never,
    bundlerUrl: input.bundlerUrl,
    // ERC-4337 on the Safe module; documented for the v0.7 entry point.
    safeModulesVersion: '0.3.0',
    options: input.safeAddress
      ? { safeAddress: input.safeAddress }
      : { owners: [ownerAddressOf(input.signer)], threshold: 1 },
    // Sponsored: the paymaster pays, so the resident's Safe needs no ETH.
    paymasterOptions: {
      paymasterUrl: input.bundlerUrl,
      isSponsored: true,
    },
  } as never);

  return pack as unknown as Safe4337PackLike;
}

/**
 * The owner address a passkey signer commits to.
 *
 * The Safe is created with one owner; the SDK derives that owner's address from
 * the credential's coordinates and the verifier. `Safe.init` resolves it, so the
 * value only has to be a valid address for the `options.owners` shape — the SDK
 * replaces it with the derived owner when it builds the deployment.
 */
function ownerAddressOf(signer: PasskeySigner): string {
  // The coordinates identify the credential; the SDK's own account abstraction
  // turns them into the on-chain owner. Passing the verifier-derived address
  // keeps `owners` non-empty, which is what the create-Safe path requires.
  return signer.verifierAddress;
}

/** The RPC endpoint, reusing the project's existing Sepolia variable. */
function rpcUrlFor(chainId: number): string {
  if (chainId !== CHAIN_IDS.sepolia) {
    throw new Error(
      `The resident-Safe path is wired for Sepolia (${CHAIN_IDS.sepolia}); ` +
        `chain ${chainId} has no RPC variable.`,
    );
  }
  const url = process.env.SEPOLIA_RPC_URL?.trim();
  if (!url) {
    throw new Error('SEPOLIA_RPC_URL is not set, so the bundler cannot be reached.');
  }
  return url;
}

/** The environment-wired entry point: the passkey signer and the batch. */
export async function executeResidentSafeBatchFromEnv(input: {
  readonly signer: PasskeySigner;
  readonly safeAddress: Address | null;
  readonly calls: readonly SafeCall[];
  readonly chainId?: number;
}): Promise<SafeExecutionOutcome> {
  const deps: SafeExecutionDependencies = {
    initPack: initSafe4337Pack,
    signer: input.signer,
    safeAddress: input.safeAddress,
    chainId: input.chainId ?? CHAIN_IDS.sepolia,
  };
  return executeResidentSafeBatch(input.calls, deps);
}

// Re-exported so callers do not need two imports for the pair.
export { pimlicoUrl, readPimlicoConfig };
