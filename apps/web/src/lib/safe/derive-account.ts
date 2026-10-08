import { CHAIN_IDS } from '@kade/shared';
import type { Address } from 'viem';
import type { PasskeySigner } from '@/lib/safe/passkey-signer';
import {
  normalizePredictedSafe,
  type PredictedSafeConfig,
} from '@/lib/safe/predicted-safe';

/**
 * The resident's account address, from Safe's own SDK.
 *
 * Safe's passkeys tutorial derives the address like this:
 *
 *   const pack = await Safe4337Pack.init({ provider, signer: passkey, bundlerUrl, options })
 *   const safeAddress   = await pack.protocolKit.getAddress()
 *   const isSafeDeployed = await pack.protocolKit.isSafeDeployed()
 *
 * This replaces the repository's own derivation — `SafeProxyFactory.getSigner`,
 * reading `proxyCreationCode` from the factory and reproducing the CREATE2
 * digest. That derivation existed because the Safe's owner was a contract whose
 * address had to be known in advance; under the passkey model the SDK computes
 * the account from the signer itself, so reproducing the arithmetic locally is
 * both unnecessary and a second source of truth for the same address.
 *
 * Both calls are reads. Nothing is deployed: the account stays counterfactual
 * until its first user operation, which is what a resident sees as
 * "created — appears on chain with the first operation".
 */

export interface DerivedAccount {
  /** The counterfactual or deployed Safe address. */
  readonly safeAddress: Address;
  /** True once the contract exists on chain. */
  readonly deployed: boolean;
  /** The chain the address was derived for. */
  readonly chainId: number;
  /**
   * The SDK's own predicted `setup` inputs, when it predicted a counterfactual
   * account. Present for the create path and absent for an existing Safe. It is
   * what lets the deployment engine reproduce the recorded address instead of
   * re-deriving it through a second, disagreeing implementation.
   */
  readonly predicted?: PredictedSafeConfig;
}

/**
 * The minimal `Safe4337Pack` surface needed to read the address.
 *
 * Declared structurally so the module is testable without the SDK or a network:
 * the SDK's asynchronous import and the RPC are the only moving parts, and both
 * are behind this seam.
 */
export interface Safe4337AddressReader {
  init(input: {
    readonly chainId: number;
    readonly signer: PasskeySigner;
  }): Promise<{
    readonly protocolKit: {
      getAddress(): Promise<string>;
      isSafeDeployed(): Promise<boolean>;
      /** The SDK's predicted config, present only for a counterfactual Safe. */
      getPredictedSafe?(): unknown;
    };
  }>;
}

export interface DeriveAccountDependencies {
  /** Defaults to the real `Safe4337Pack.init` through Pimlico. */
  readonly reader?: Safe4337AddressReader;
  readonly chainId?: number;
}

/**
 * Derive the resident's account address from their passkey.
 *
 * A failure is surfaced rather than swallowed: an address that could not be
 * derived must not be stored as if it had been, because the resident would then
 * see an account that does not correspond to their signer.
 */
export async function deriveAccountFromPasskey(
  signer: PasskeySigner,
  deps: DeriveAccountDependencies = {},
): Promise<DerivedAccount> {
  const chainId = deps.chainId ?? CHAIN_IDS.sepolia;
  const reader = deps.reader ?? (await defaultReader(chainId));

  const pack = await reader.init({ chainId, signer });

  const [address, deployed] = await Promise.all([
    pack.protocolKit.getAddress(),
    pack.protocolKit.isSafeDeployed(),
  ]);

  // The SDK's own predicted config, when it composed a counterfactual account.
  // It is reported unmodified so the deployment engine can rebuild the exact
  // initializer the address commits to; a missing config stays absent rather
  // than being reconstructed by hand.
  const predicted =
    typeof pack.protocolKit.getPredictedSafe === 'function'
      ? normalizePredictedSafe(pack.protocolKit.getPredictedSafe())
      : undefined;

  return {
    safeAddress: address as Address,
    deployed,
    chainId,
    ...(predicted ? { predicted } : {}),
  };
}

/**
 * The real reader: `Safe4337Pack.init` with the Pimlico bundler.
 *
 * The bundler URL is only needed to reach the SDK's configuration; this path
 * performs two reads and submits nothing, so a missing Pimlico key surfaces as
 * the SDK's own error rather than a silent empty address.
 */
async function defaultReader(
  chainId: number,
): Promise<Safe4337AddressReader> {
  const { initSafe4337Pack } = await import('@/lib/safe/execute-safe-4337-env');

  return {
    init: async (input) => {
      const pack = await initSafe4337Pack({
        chainId: input.chainId,
        signer: input.signer,
        // No Safe exists yet: the SDK derives the counterfactual address from
        // the signer, which is exactly what this call is for.
        safeAddress: null,
        bundlerUrl: bundlerUrlFor(input.chainId),
      });

      return pack as unknown as Awaited<
        ReturnType<Safe4337AddressReader['init']>
      >;
    },
  };
}

/** The Pimlico bundler endpoint, read server-side. */
function bundlerUrlFor(chainId: number): string {
  const apiKey = process.env.PIMLICO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'PIMLICO_API_KEY is not set, so the account address cannot be read.',
    );
  }
  return `https://api.pimlico.io/v2/${chainId}/rpc?add_balance_override&apikey=${apiKey}`;
}
