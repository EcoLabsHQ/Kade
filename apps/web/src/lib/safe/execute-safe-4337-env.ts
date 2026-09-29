import {
  CHAIN_IDS,
  rpcEnvVarForChain,
  SAFE_4337_MODULE,
  SAFE_DEPLOYMENTS,
  SAFE_PASSKEY_MODULE,
  type SafeVersion,
} from '@kade/shared';
import { PimlicoFeeEstimator } from '@safe-global/relay-kit';
import type { Address } from 'viem';
import {
  buildResidentSafeBatch,
  PIMLICO_ENV_KEYS,
  pimlicoUrl,
  readPimlicoConfig,
  submitResidentSafeOperation,
  type Safe4337PackLike,
  type SafeAssertionParts,
  type SafeBuildOutcome,
  type SafeCall,
  type SafeExecutionDependencies,
  type SafeSubmitOutcome,
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
 *
 * The existing-Safe path uses `init` exactly as the guide shows. The create-Safe
 * path must additionally pin the two chain-dependent address inputs (the salt
 * and the singleton); see `createPinnedSafe4337Pack`.
 */
export async function initSafe4337Pack(input: {
  readonly chainId: number;
  readonly signer: PasskeySigner;
  readonly safeAddress: Address | null;
  readonly bundlerUrl: string;
}): Promise<Safe4337PackLike> {
  const { Safe4337Pack, createBundlerClient } = await import(
    '@safe-global/relay-kit'
  );

  const provider = rpcUrlFor(input.chainId);

  // Sponsored: the paymaster pays, so the resident's Safe needs no ETH. The
  // sponsorship policy constrains what Pimlico will sponsor; the SDK only
  // forwards it when `sponsorshipPolicyId` is set, so it is attached whenever
  // the configuration supplies one.
  const paymasterOptions = {
    paymasterUrl: input.bundlerUrl,
    isSponsored: true,
    ...sponsorshipPolicyOption(input.chainId),
  };

  if (input.safeAddress) {
    // The existing-Safe path is unchanged: relay-kit initialises the Safe it is
    // given, and no prediction or create2 input is involved.
    const pack = await Safe4337Pack.init({
      provider,
      // The passkey is the owner, so it is passed whole — not as an address.
      signer: input.signer as never,
      bundlerUrl: input.bundlerUrl,
      // ERC-4337 on the Safe module; documented for the v0.7 entry point.
      safeModulesVersion: SAFE_4337_MODULE.safeModulesVersion,
      options: { safeAddress: input.safeAddress },
      paymasterOptions,
    } as never);

    return pack as unknown as Safe4337PackLike;
  }

  return createPinnedSafe4337Pack({
    Safe4337Pack: Safe4337Pack as unknown as CreateSafePackConstructor,
    createBundlerClient: createBundlerClient as unknown as BundlerClientFactory,
    chainId: input.chainId,
    signer: input.signer,
    provider,
    bundlerUrl: input.bundlerUrl,
    paymasterOptions,
  });
}

/**
 * The create-Safe path, with the two chain-dependent inputs pinned.
 *
 * `@safe-global/protocol-kit` feeds two chain-dependent values into the
 * counterfactual Safe address, and both must be neutralised for the address to
 * be the same on every chain:
 *
 *   1. **The salt.** The default is chain-derived:
 *      `getChainSpecificDefaultSaltNonce(chainId) =
 *       keccak256(PREDETERMINED_SALT_NONCE + chainId)`, so the same passkey
 *      yields a different address per chain. The create path passes
 *      `saltNonce: '0'`, a fixed value, so the salt is chain-independent.
 *   2. **The singleton.** `ContractManager` defaults `isL1SafeSingleton` to
 *      `safeDeploymentsL1ChainIds.includes(chainId)` and, in protocol-kit 8.0.7,
 *      `safeDeploymentsL1ChainIds = [1n]` — **only Ethereum mainnet**. So
 *      mainnet predicts against the SafeL1 singleton while every other chain,
 *      Sepolia included, silently predicts against SafeL2. The singleton is part
 *      of the create2 init code, so the two chains disagree. This path pins the
 *      L1 singleton for the predicted Safe's version through `contractNetworks`,
 *      which `predictSafeAddress` reads for
 *      `contractNetworks[chainId].safeSingletonAddress`.
 *
 * relay-kit's `Safe4337Pack.init` does **not** forward `contractNetworks` to
 * `Safe.init`, so the singleton cannot be pinned through `init`. Instead the
 * pack is assembled through the public constructor, which accepts a pre-built
 * `protocolKit`:
 *
 *   1. run relay-kit's own `init` once with the fixed salt to obtain its
 *      predicted initializer (`getPredictedSafe()`), passing the module,
 *      entry-point and shared-signer addresses explicitly so relay-kit uses our
 *      constants rather than resolving them per chain;
 *   2. build a `protocolKit` from that exact predicted config with the L1
 *      singleton pinned;
 *   3. assemble the pack with the same constants, so the constructor's module
 *      address is the `fallbackHandler` the initializer was built with.
 */
async function createPinnedSafe4337Pack(input: {
  readonly Safe4337Pack: CreateSafePackConstructor;
  readonly createBundlerClient: BundlerClientFactory;
  readonly chainId: number;
  readonly signer: PasskeySigner;
  readonly provider: string;
  readonly bundlerUrl: string;
  readonly paymasterOptions: Record<string, unknown>;
}): Promise<Safe4337PackLike> {
  // One source of truth for the addresses relay-kit writes into the predicted
  // initializer and the constructor reads back out of it.
  const contracts = createSafe4337Contracts();

  // Step 1 — relay-kit composes the predicted initializer (owners, module
  // enablement, fallback handler, version and salt) using our constants.
  const seed = (await input.Safe4337Pack.init({
    provider: input.provider,
    signer: input.signer as never,
    bundlerUrl: input.bundlerUrl,
    safeModulesVersion: SAFE_4337_MODULE.safeModulesVersion,
    customContracts: contracts,
    options: {
      owners: [ownerAddressOf(input.signer)],
      threshold: 1,
      // Fixed, never the chain-derived default, so the salt is chain-independent.
      saltNonce: FIXED_CREATE2_SALT_NONCE,
    },
    paymasterOptions: input.paymasterOptions,
  } as never)) as SeedPack;

  const predictedSafe = seed.protocolKit.getPredictedSafe();
  if (!predictedSafe) {
    throw new Error(
      'relay-kit returned no predicted Safe, so the create-Safe address cannot ' +
        'be pinned.',
    );
  }

  // The singleton must be the L1 one for the predicted Safe's version. relay-kit
  // defaults to 1.4.1; resolving from the config rather than assuming it keeps
  // the pin correct if that default ever moves.
  const safeVersion = predictedSafe.safeDeploymentConfig?.safeVersion ?? '1.4.1';
  const singleton = l1SingletonFor(safeVersion);

  // Step 2 — our own protocolKit, from relay-kit's exact predicted config, with
  // the singleton pinned so `predictSafeAddress` uses it on every chain.
  const Safe = (await import('@safe-global/protocol-kit')).default;
  const protocolKit = await Safe.init({
    provider: input.provider,
    signer: input.signer as never,
    predictedSafe,
    contractNetworks: {
      [String(input.chainId)]: { safeSingletonAddress: singleton },
    },
  } as never);

  // Step 3 — the public constructor accepts the pre-built protocolKit. The
  // module/entry-point/shared-signer addresses are the very same constants the
  // initializer was built with; the constructor's `safe4337ModuleAddress` is the
  // `fallbackHandler` relay-kit resolved, and `safeWebAuthnSharedSignerAddress`
  // is the signer address it uses when signing.
  return new input.Safe4337Pack({
    protocolKit,
    bundlerClient: input.createBundlerClient(input.bundlerUrl),
    bundlerUrl: input.bundlerUrl,
    chainId: BigInt(input.chainId),
    paymasterOptions: input.paymasterOptions,
    entryPointAddress: contracts.entryPointAddress,
    safe4337ModuleAddress: contracts.safe4337ModuleAddress,
    safeWebAuthnSharedSignerAddress: contracts.safeWebAuthnSharedSignerAddress,
  }) as unknown as Safe4337PackLike;
}

/** The fixed create2 salt nonce used whenever Kade predicts a Safe. */
export const FIXED_CREATE2_SALT_NONCE = '0';

/** The three addresses relay-kit uses for the Safe 4337 module. */
interface Safe4337Contracts {
  readonly entryPointAddress: string;
  readonly safe4337ModuleAddress: string;
  readonly safeModulesSetupAddress: string;
  readonly safeWebAuthnSharedSignerAddress: string;
}

function createSafe4337Contracts(): Safe4337Contracts {
  return {
    entryPointAddress: SAFE_4337_MODULE.entryPoint.value,
    safe4337ModuleAddress: SAFE_4337_MODULE.safe4337Module.value,
    // Part of the predicted initializer's `to` (the module-enable call target),
    // so pinning it removes the last chain/bundler-resolved address input.
    safeModulesSetupAddress: SAFE_4337_MODULE.safeModuleSetup.value,
    safeWebAuthnSharedSignerAddress:
      SAFE_PASSKEY_MODULE.safeWebAuthnSharedSigner.value,
  };
}

/** The L1 singleton for a Safe version, from the shared deployment record. */
function l1SingletonFor(safeVersion: string): string {
  const deployment = SAFE_DEPLOYMENTS[safeVersion as SafeVersion];
  if (!deployment) {
    throw new Error(
      `No Safe deployment is recorded for version ${safeVersion}, so the ` +
        'L1 singleton cannot be pinned.',
    );
  }
  return deployment.safeSingleton.value;
}

/**
 * The slice of `Safe4337Pack.init`'s result this module reads. `protocolKit` is
 * public on the SDK's pack; only the predicted config is needed here.
 */
interface PredictedSafeConfig {
  readonly safeAccountConfig: { readonly fallbackHandler?: string };
  readonly safeDeploymentConfig?: {
    readonly safeVersion?: string;
    readonly saltNonce?: string;
  };
}

interface SeedPack {
  readonly protocolKit: {
    getPredictedSafe(): PredictedSafeConfig | undefined;
  };
}

/**
 * The SDK class as used here: a static `init` whose result exposes the predicted
 * config, and a constructor that accepts a pre-built `protocolKit`. Typed
 * structurally so the module is testable without the SDK.
 */
interface CreateSafePackConstructor {
  init(input: unknown): Promise<SeedPack>;
  new (input: {
    readonly protocolKit: unknown;
    readonly bundlerClient: unknown;
    readonly bundlerUrl: string;
    readonly chainId: bigint;
    readonly paymasterOptions: Record<string, unknown>;
    readonly entryPointAddress: string;
    readonly safe4337ModuleAddress: string;
    readonly safeWebAuthnSharedSignerAddress: string;
  }): unknown;
}

type BundlerClientFactory = (bundlerUrl: string) => unknown;

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
 * Safe address. **Do not change either**: the owner set is how the passkey is
 * written into the Safe, and any change produces a different Safe.
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
 * going through the build/submit phases (which are what enforce that both keys
 * are present). When neither yields a value, nothing is attached: the
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
 * The vault rail now covers Ethereum **mainnet**, **Base** and **Arbitrum One**
 * (the per-chain MetaMorpho rail), while the rest of the tooling may stay on
 * Sepolia, so each chain resolves to its own variable. Any other chain, or a
 * supported chain whose variable is missing, refuses rather than reaching for
 * the wrong endpoint.
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
  const variable = rpcEnvVarForChain(chainId);
  if (!variable) {
    throw new Error(
      `The resident-Safe path supports Sepolia (${CHAIN_IDS.sepolia}), ` +
        `Ethereum mainnet (${CHAIN_IDS.ethereum}), Base (${CHAIN_IDS.base}) and ` +
        `Arbitrum One (${CHAIN_IDS.arbitrum}); chain ${chainId} has no RPC ` +
        'variable.',
    );
  }
  return variable;
}

/**
 * The environment-wired build phase: no signing, just the operation and the
 * hash the browser passkey must sign.
 */
export async function buildResidentSafeBatchFromEnv(input: {
  readonly signer: PasskeySigner;
  readonly safeAddress: Address | null;
  readonly calls: readonly SafeCall[];
  readonly chainId?: number;
}): Promise<SafeBuildOutcome> {
  const deps: SafeExecutionDependencies = {
    initPack: initSafe4337Pack,
    signer: input.signer,
    safeAddress: input.safeAddress,
    chainId: input.chainId ?? CHAIN_IDS.sepolia,
    // The SDK's own estimator is wrapped by the build phase, which raises the
    // account's verification gas before Pimlico signs over it.
    feeEstimator: new PimlicoFeeEstimator(),
  };
  return buildResidentSafeBatch(input.calls, deps);
}

/**
 * The environment-wired submit phase: the client's assertion over the hash the
 * build phase returned. The operation itself never comes from the client.
 */
export async function submitResidentSafeOperationFromEnv(input: {
  readonly token: string;
  readonly assertion: SafeAssertionParts;
  readonly signer: PasskeySigner;
  readonly safeAddress: Address | null;
  readonly chainId?: number;
}): Promise<SafeSubmitOutcome> {
  const deps: SafeExecutionDependencies = {
    initPack: initSafe4337Pack,
    signer: input.signer,
    safeAddress: input.safeAddress,
    chainId: input.chainId ?? CHAIN_IDS.sepolia,
  };
  return submitResidentSafeOperation(
    { token: input.token, assertion: input.assertion },
    deps,
  );
}

// Re-exported so callers do not need two imports for the pair.
export { pimlicoUrl, readPimlicoConfig };
