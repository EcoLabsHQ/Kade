import { CHAIN_IDS } from '@kade/shared';
import type { Address } from 'viem';
import {
  executeResidentSafeBatch,
  pimlicoBundlerUrl,
  readPimlicoConfig,
  type Safe4337PackLike,
  type SafeCall,
  type SafeExecutionOutcome,
} from './execute-safe-4337';

/**
 * The environment-wired resident-Safe execution.
 *
 * Wires the documented Safe flow to the real Pimlico endpoints and to the
 * on-chain WebAuthn signer, reading every secret server-side. The signing
 * identity is the passkey: `Safe4337Pack.init` receives the **signer** the
 * resident's Safe is owned by, which is the deployed `SafeWebAuthnSigner`.
 *
 * Two things must be true before anything is sent, and both are checked rather
 * than assumed:
 *
 *   1. the signer contract has code (otherwise no passkey signature validates);
 *   2. the Pimlico keys are present (otherwise there is no sponsoring bundler).
 *
 * When either is missing the call returns a refusal with the precise reason and
 * sends nothing. That is the honest state until the signer is deployed, and it
 * is deliberately not hidden behind a fake success.
 */

/** What the caller supplies: the batch and the Safe that will execute it. */
export interface ResidentSafeBatchRequest {
  readonly safeAddress: Address;
  /** The Safe's owner: the WebAuthn signer address. */
  readonly ownerAddress: Address;
  readonly calls: readonly SafeCall[];
  readonly chainId?: number;
}

export async function executeResidentSafeBatchFromEnv(
  request: ResidentSafeBatchRequest,
): Promise<SafeExecutionOutcome> {
  const chainId = request.chainId ?? CHAIN_IDS.sepolia;

  return executeResidentSafeBatch(
    request.calls,
    {
      safeAddress: request.safeAddress,
      ownerAddress: request.ownerAddress,
      chainId,
      initPack: initSafe4337Pack,
    },
    process.env,
  );
}

/**
 * `Safe4337Pack.init`, with the paymaster sponsoring the gas.
 *
 * The documented sponsored shape is `paymasterOptions: { paymasterUrl,
 * isSponsored: true }` — verified against the installed relay-kit's own types,
 * not assumed. `isSponsored` is what makes this free for the resident: the Safe
 * holds no ETH and the paymaster pays.
 */
async function initSafe4337Pack(input: {
  readonly chainId: number;
  readonly safeAddress: Address;
  readonly bundlerUrl: string;
  readonly ownerAddress: Address;
}): Promise<Safe4337PackLike> {
  const pimlico = readPimlicoConfig(input.chainId);
  if (pimlico === null) {
    throw new Error('The Pimlico keys are not configured.');
  }

  const { Safe4337Pack } = await import('@safe-global/relay-kit');

  const pack = await Safe4337Pack.init({
    provider: rpcUrlFor(input.chainId),
    // The resident's Safe is owned by the on-chain WebAuthn signer; the passkey
    // assertion is produced by that signer, so this is the signing identity.
    signer: input.ownerAddress,
    bundlerUrl: pimlicoBundlerUrl(pimlico),
    options: {
      safeAddress: input.safeAddress,
    },
    paymasterOptions: {
      paymasterUrl: pimlicoBundlerUrl(pimlico),
      isSponsored: true,
    },
    safeModulesVersion: '0.3.0',
  });

  return pack as unknown as Safe4337PackLike;
}

/**
 * The RPC endpoint for a chain, server-side.
 *
 * Reuses the project's existing per-chain variable rather than inventing a new
 * one: `SEPOLIA_RPC_URL` is what the Safe deployment path already reads.
 */
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
