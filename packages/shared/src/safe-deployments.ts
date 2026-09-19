/**
 * Safe contract addresses, taken from Safe's own published deployments.
 *
 * Source: the `safe-deployments` repository (`src/assets/<version>/<contract>.json`)
 * and the `safe-modules` passkey changelog. Every address below is the
 * deployment file's `canonical` address, and the code hashes are recorded so a
 * deployment script can verify it is talking to the contract it thinks it is.
 *
 * Version choice matters and is recorded here rather than assumed:
 *
 *   v1.5.0 is the latest Safe release. It has NO Arbitrum Sepolia deployment,
 *   so adopting it required dropping Arbitrum from the iteration-1 chain set.
 *   The owner made both decisions together (contract v1.6).
 *
 *   v1.4.1 covers Arbitrum Sepolia as well, so it is still the right choice for
 *   anyone who needs that chain; its addresses are recorded below for that
 *   reason.
 *
 * The active version is a configuration value, and the reason it is what it is
 * is written down here. The `SafeProxy` creation code is part of the address
 * digest, so it must match the active version: the constant below is v1.5.0's.
 */

import { sourced, type Sourced } from './provenance.js';

export type SafeVersion = '1.4.1' | '1.5.0';

export interface SafeDeployment {
  readonly version: SafeVersion;
  readonly safeProxyFactory: Sourced<`0x${string}`>;
  readonly safeL2: Sourced<`0x${string}`>;
  readonly safeSingleton: Sourced<`0x${string}`>;
  readonly compatibilityFallbackHandler: Sourced<`0x${string}`>;
  readonly codeHashes: {
    readonly safeProxyFactory: `0x${string}`;
    readonly safeL2: `0x${string}`;
    readonly compatibilityFallbackHandler: `0x${string}`;
  };
  /** Whether the version is deployed on each testnet D4 needs. */
  readonly testnets: {
    readonly sepolia: boolean;
    readonly arbitrumSepolia: boolean;
    readonly baseSepolia: boolean;
  };
}

export const SAFE_DEPLOYMENTS: Readonly<Record<SafeVersion, SafeDeployment>> = {
  // Retained because it is the only release deployed on Arbitrum Sepolia.
  // Not the active version: see ACTIVE_SAFE_VERSION below.
  '1.4.1': {
    version: '1.4.1',
    safeProxyFactory: sourced(
      '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
      'external',
      'safe-deployments src/assets/v1.4.1/safe_proxy_factory.json',
    ),
    safeL2: sourced(
      '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
      'external',
      'safe-deployments src/assets/v1.4.1/safe_l2.json',
    ),
    safeSingleton: sourced(
      '0x41675C099F32341bf84BFc5382aF534df5C7461a',
      'external',
      'safe-deployments src/assets/v1.4.1/safe.json',
    ),
    compatibilityFallbackHandler: sourced(
      '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99',
      'external',
      'safe-deployments src/assets/v1.4.1/compatibility_fallback_handler.json',
    ),
    codeHashes: {
      safeProxyFactory:
        '0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317',
      safeL2: '0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff',
      compatibilityFallbackHandler:
        '0x7c6007a5d711cea8dfd5d91f5940ec29c7f200fe511eb1fc1397b367af3c42f9',
    },
    testnets: { sepolia: true, arbitrumSepolia: true, baseSepolia: true },
  },
  '1.5.0': {
    version: '1.5.0',
    safeProxyFactory: sourced(
      '0x14F2982D601c9458F93bd70B218933A6f8165e7b',
      'external',
      'safe-deployments src/assets/v1.5.0/safe_proxy_factory.json',
    ),
    safeL2: sourced(
      '0xEdd160fEBBD92E350D4D398fb636302fccd67C7e',
      'external',
      'safe-deployments src/assets/v1.5.0/safe_l2.json',
    ),
    safeSingleton: sourced(
      '0xFf51A5898e281Db6DfC7855790607438dF2ca44b',
      'external',
      'safe-deployments src/assets/v1.5.0/safe.json',
    ),
    compatibilityFallbackHandler: sourced(
      '0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4',
      'external',
      'safe-deployments src/assets/v1.5.0/compatibility_fallback_handler.json',
    ),
    codeHashes: {
      safeProxyFactory:
        '0x967dae4cda22b0c9ef7f31b010bdc1ceb0af9904b0c3dc060b5302e4c18a4529',
      safeL2: '0x180193227186ccb85316c94db1f0d156ed932b14712cfaac78901899178572dc',
      compatibilityFallbackHandler:
        '0x3c6a85bcf7b563daa624b884b4e9a1b9fa5371edde7be945d998071a48f28bbc',
    },
    testnets: { sepolia: true, arbitrumSepolia: false, baseSepolia: true },
  },
};

/**
 * The Safe release iteration 1 uses.
 *
 * [documented] The project owner chose v1.5.0 and dropped Arbitrum from the
 * iteration-1 chain set, so the one gap v1.5.0 had — no Arbitrum Sepolia
 * deployment — no longer blocks it. v1.5.0 is deployed on Ethereum Sepolia and
 * Base Sepolia, which are the active testnets (contract v1.6).
 */
export const ACTIVE_SAFE_VERSION: SafeVersion = '1.5.0';

export interface PasskeyModuleDeployment {
  readonly version: string;
  readonly safeWebAuthnSignerFactory: Sourced<`0x${string}`>;
  readonly safeWebAuthnSharedSigner: Sourced<`0x${string}`>;
  readonly p256Verifier: Sourced<`0x${string}`>;
  readonly p256VerifierName: string;
}

/**
 * The passkey module, which provides the Safe owner: a contract that verifies a
 * WebAuthn assertion (EIP-1271) rather than an EOA.
 *
 * Module v0.2.1. The signer factory had been recorded as `[arbitrary]` — carried
 * over from a changelog rather than confirmed. It is now verified: the contract
 * at that address answers `getSigner(uint256,uint256,uint176)`, the interface
 * `SafeWebAuthnSignerFactory` declares, with the third parameter being
 * `P256.Verifiers` (a packed `uint176`, not a `uint256`) — which is why an
 * earlier check that looked for a `uint256` overload found nothing.
 *
 * The verifier is Daimo's (`p256.eth.limo`), not FCLP256Verifier: the current
 * module version removed the latter because of known bugs. The precompile half
 * of `P256.Verifiers` is left zero, so verification falls through to this
 * Solidity verifier — Sepolia has no EIP-7212 precompile.
 */
export const SAFE_PASSKEY_MODULE: PasskeyModuleDeployment = {
  version: '0.2.1',
  safeWebAuthnSignerFactory: sourced(
    '0x1d31F259eE307358a26dFb23EB365939E8641195',
    'external',
    'safe-modules passkey/v0.2.1; interface confirmed by calling getSigner(uint256,uint256,uint176) against the deployed contract',
  ),
  safeWebAuthnSharedSigner: sourced(
    '0x94a4F6affBd8975951142c3999aEAB7ecee555c2',
    'arbitrary',
    'safe-modules passkey changelog v0.2.1 expected addresses; not yet confirmed against the deployed contract',
  ),
  p256Verifier: sourced(
    '0xc2b78104907F722DABAc4C69f826a522B2754De4',
    'external',
    'Daimo P256 verifier, published by Daimo at p256.eth.limo; bytecode present on Sepolia',
  ),
  p256VerifierName: 'DaimoP256Verifier',
};

/**
 * `SafeProxy` creation code **as built by this repository**.
 *
 * This is *not* the code the deployed factory uses, and must not be used to
 * derive an address. It is here because `SafeAddress.t.sol` pins this
 * repository's own artifact, so a toolchain change breaks that test rather than
 * silently altering what our own build produces.
 *
 * The two differ, and the difference is not cosmetic:
 *
 *   - this local build: 649 bytes, `keccak256 = 0xa547798e…adc906cf`
 *     (Solidity 0.8.24, optimiser disabled, `safe-smart-account` v1.5.0);
 *   - the deployed v1.5.0 factory at
 *     `0x14F2982D601c9458F93bd70B218933A6f8165e7b`, read from its
 *     `proxyCreationCode()` view: 438 bytes,
 *     `keccak256 = 0x941b3e88811b2f33b8e26783c7407d2e978404581a21c9f07abf2cad9cb87e12`.
 *
 * Because the creation code is part of the CREATE2 digest, deriving from the
 * local copy yields an address the deployed factory will never deploy. The
 * address derivation therefore reads `proxyCreationCode()` from the factory at
 * runtime; see `apps/web/src/app/onboarding/signer-actions.ts`.
 */
export const SAFE_PROXY_CREATION_CODE = (
  '0x608060405234801561000f575f80fd5b506040516102893803806102898339' +
  '8181016040528101906100319190610142565b5f73ffffffffffffffffffffff' +
  'ffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff' +
  '160361009f576040517f08c379a0000000000000000000000000000000000000' +
  '000000000000000000008152600401610096906101ed565b60405180910390fd' +
  '5b805f806101000a81548173ffffffffffffffffffffffffffffffffffffffff' +
  '021916908373ffffffffffffffffffffffffffffffffffffffff160217905550' +
  '5061020b565b5f80fd5b5f73ffffffffffffffffffffffffffffffffffffffff' +
  '82169050919050565b5f610111826100e8565b9050919050565b610121816101' +
  '07565b811461012b575f80fd5b50565b5f8151905061013c81610118565b9291' +
  '5050565b5f60208284031215610157576101566100e4565b5b5f610164848285' +
  '0161012e565b91505092915050565b5f82825260208201905092915050565b7f' +
  '496e76616c69642073696e676c65746f6e20616464726573732070726f766964' +
  '5f8201527f656400000000000000000000000000000000000000000000000000' +
  '0000000000602082015250565b5f6101d760228361016d565b91506101e28261' +
  '017d565b604082019050919050565b5f6020820190508181035f830152610204' +
  '816101cb565b9050919050565b6072806102175f395ff3fe60806040525f5463' +
  'a619486e5f3560e01c036021578060601b606c5260206060f35b365f80375f80' +
  '365f845af43d5f803e806038573d5ffd5b3d5ff3fea26469706673582212200f' +
  'b743e2524297bda39648625de92a4595300fb36d65f70fd24707b1707f0e0c64' +
  '736f6c63430008180033') as `0x${string}`;

/** `keccak256(SAFE_PROXY_CREATION_CODE)`, matching the Foundry test. */
export const SAFE_PROXY_CREATION_CODE_HASH =
  '0xa547798e9cb7097a11fa42521894d2a7522e2deb5d8acbcef74b6e92adc906cf' as const;

/**
 * The `SafeProxy` creation code the deployed v1.5.0 factory uses, read from its
 * `proxyCreationCode()` view on Ethereum Sepolia.
 *
 * Recorded rather than used as an input: `deriveAccount` reads the factory at
 * runtime, because a factory on another chain could carry different bytes. It is
 * here so the bytes that decide every resident's address can be reviewed and
 * tested instead of only being observable against a live node.
 */
export const DEPLOYED_SAFE_PROXY_CREATION_CODE = (
  '0x608060405234801561001057600080fd5b506040516101b63803806101b68339' +
  '818101604052602081101561003357600080fd5b810190808051906020019092' +
  '9190505050600073ffffffffffffffffffffffffffffffffffffffff168173ff' +
  'ffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c3' +
  '79a0000000000000000000000000000000000000000000000000000000008152' +
  '6004018080602001828103825260228152602001806101946022913960400191' +
  '505060405180910390fd5b806000806101000a81548173ffffffffffffffffff' +
  'ffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffff' +
  'ffffffffff16021790555050607b806101196000396000f3fe60806040526000' +
  '5463a619486e60003560e01c14156024578060601b606c5260206060f35b3660' +
  '008037600080366000845af43d6000803e806040573d6000fd5b3d6000f3fea2' +
  '646970667358221220e61834ebd2d8cd909d362bf67c47ef58fd665df38e6dd0' +
  '36ce65611101d072e964736f6c63430007060033496e76616c69642073696e67' +
  '6c65746f6e20616464726573732070726f7669646564') as `0x${string}`;

/**
 * `keccak256` of the `SafeProxy` creation code the deployed v1.5.0 factory
 * actually uses, read from its `proxyCreationCode()` view on Ethereum Sepolia.
 *
 * Recorded so the mismatch with `SAFE_PROXY_CREATION_CODE_HASH` is visible and
 * checkable rather than rediscovered. It is an expected value, not an input: the
 * derivation reads the code itself at runtime, because a factory on another
 * chain could carry different bytes.
 */
export const DEPLOYED_SAFE_PROXY_CREATION_CODE_HASH =
  '0x941b3e88811b2f33b8e26783c7407d2e978404581a21c9f07abf2cad9cb87e12' as const;
