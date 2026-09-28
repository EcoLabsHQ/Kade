import { CHAIN_IDS } from '@kade/shared';
import type { Address } from 'viem';
import {
  executeResidentSafeBatch,
  PIMLICO_ENV_KEYS,
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
    // Sponsored: the paymaster pays, so the resident's Safe needs no ETH. The
    // sponsorship policy constrains what Pimlico will sponsor; the SDK only
    // forwards it when `sponsorshipPolicyId` is set, so it is attached whenever
    // the configuration supplies one.
    paymasterOptions: {
      paymasterUrl: input.bundlerUrl,
      isSponsored: true,
      ...sponsorshipPolicyOption(input.chainId),
    },
  } as never);

  return pack as unknown as Safe4337PackLike;
}

/**
 * The owner address the resident Safe is created with.
 *
 * The value is the signer's verifier-derived address, and it is the **first**
 * entry of `options.owners`. `@safe-global/relay-kit` (6.1.1) does **not**
 * replace it with a derived owner: for a passkey signer it **appends**
 * `SafeWebAuthnSharedSigner` to `options.owners` (when it is not already there)
 * and then uses that list verbatim in the predicted initializer, e.g.
 *
 *   options.owners = [verifierAddress, SafeWebAuthnSharedSigner]
 *   Safe.init({ predictedSafe: { safeAccountConfig: { owners: options.owners,
 *     threshold: 1, ... } } })
 *
 * The owner set and the threshold are therefore inputs to the counterfactual
 * Safe address. **Do not change either**: the address recorded in
 * `safe_deployments` for existing residents was derived from exactly this pair,
 * and any change would produce a different Safe.
 */
function ownerAddressOf(signer: PasskeySigner): string {
  // The coordinates identify the credential; this verifier-derived address is
  // the owner entry Safe uses verbatim. Keeping `owners` non-empty is what the
  // create-Safe path requires.
  return signer.verifierAddress;
}

/**
 * The Pimlico sponsorship policy, as paymaster options the SDK reads.
 *
 * `readPimlicoConfig` is the single source of truth and already yields the
 * policy id when the server keys are both set, so it is tried first. The env
 * read is the fallback for a caller that reaches `initSafe4337Pack` without
 * going through `executeResidentSafeBatch` (which is what enforces that both
 * keys are present). When neither yields a value, nothing is attached: the
 * pre-existing unconfigured behaviour is unchanged, never weakened.
 */
function sponsorshipPolicyOption(chainId: number): { sponsorshipPolicyId?: string } {
  const policyId =
    readPimlicoConfig(chainId)?.policyId ??
    process.env[PIMLICO_ENV_KEYS.policyId]?.trim();
  return policyId ? { sponsorshipPolicyId: policyId } : {};
}

/**
 * The RPC endpoint for the chain the Safe runs on.
 *
 * The vault rail is Ethereum **mainnet** (contract §2.2/§6.3), while the rest
 * of the tooling may stay on Sepolia, so both chains resolve to their own
 * variable. Any other chain, or a supported chain whose variable is missing,
 * refuses rather than reaching for the wrong endpoint.
 */
function rpcUrlFor(chainId: number): string {
  const variable = rpcVariableFor(chainId);
  const url = process.env[variable]?.trim();
  if (!url) {
    throw new Error(`${variable} is not set, so the bundler cannot be reached.`);
  }
  return url;
}

/** The env variable that holds the RPC for a supported chain, or a refusal. */
function rpcVariableFor(chainId: number): string {
  switch (chainId) {
    case CHAIN_IDS.sepolia:
      return 'SEPOLIA_RPC_URL';
    case CHAIN_IDS.ethereum:
      return 'ETHEREUM_RPC_URL';
    default:
      throw new Error(
        `The resident-Safe path supports Sepolia (${CHAIN_IDS.sepolia}) and ` +
          `Ethereum mainnet (${CHAIN_IDS.ethereum}); chain ${chainId} has no ` +
          'RPC variable.',
      );
  }
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
