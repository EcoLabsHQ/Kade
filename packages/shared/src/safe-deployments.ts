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
 *   v1.5.0 is the latest Safe release, but `safe_l2` v1.5.0 has NO entry for
 *   Arbitrum Sepolia (421614). D4 requires one address across Ethereum Sepolia,
 *   Arbitrum Sepolia and Base Sepolia, so v1.5.0 cannot satisfy it.
 *
 *   v1.4.1 covers all three testnets, and its `SafeProxy` creation code is
 *   pinned in this repository by a Foundry test, so the address derivation can
 *   be checked against a fixed vector.
 *
 * The active version is therefore a configuration value, and the reason it is
 * what it is is written down here.
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
 * [documented] v1.4.1 is the newest release deployed on all three testnets D4
 * requires, and the only one whose proxy creation code this repository pins.
 * v1.5.0 is newer but absent from Arbitrum Sepolia.
 */
export const ACTIVE_SAFE_VERSION: SafeVersion = '1.4.1';

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
 * [arbitrary] The published addresses below belong to module v0.2.1, the most
 * recent release whose addresses the changelog lists. v0.3.0 removed the
 * FCLP256Verifier and does not publish replacement addresses, so its signer
 * factory address must be confirmed before use.
 *
 * The verifier is Daimo's (`p256.eth.limo`), not FCLP256Verifier: the current
 * module version removed the latter because of known bugs.
 */
export const SAFE_PASSKEY_MODULE: PasskeyModuleDeployment = {
  version: '0.2.1',
  safeWebAuthnSignerFactory: sourced(
    '0x1d31F259eE307358a26dFb23EB365939E8641195',
    'arbitrary',
    'safe-modules passkey changelog v0.2.1 expected addresses',
  ),
  safeWebAuthnSharedSigner: sourced(
    '0x94a4F6affBd8975951142c3999aEAB7ecee555c2',
    'arbitrary',
    'safe-modules passkey changelog v0.2.1 expected addresses',
  ),
  p256Verifier: sourced(
    '0xc2b78104907F722DABAc4C69f826a522B2754De4',
    'arbitrary',
    'Daimo P256 verifier, published by Daimo at p256.eth.limo',
  ),
  p256VerifierName: 'DaimoP256Verifier',
};

/**
 * `SafeProxy` creation code, pinned to this repository's Foundry build.
 *
 * The creation code is part of the CREATE2 digest, so the deployed address
 * changes if the compiler, the optimiser settings or the Safe version change.
 * `packages/contracts/test/SafeAddress.t.sol` pins the same hash
 * (`0x31e47991bd716464184e3ee59819f71d5f5e1fecec59e382e311ca3c9409a7cc`), so a
 * toolchain change breaks that test rather than silently shifting every
 * resident's address.
 *
 * Solidity 0.8.24, optimiser disabled, `safe-smart-account` v1.4.1.
 */
export const SAFE_PROXY_CREATION_CODE = (
  '0x608060405234801561000f575f80fd5b506040516102b53803806102b58339' +
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
  '816101cb565b9050919050565b609e806102175f395ff3fe608060405273ffff' +
  'ffffffffffffffffffffffffffffffffffff5f54167fa619486e000000000000' +
  '000000000000000000000000000000000000000000005f3503604b57805f5260' +
  '205ff35b365f80375f80365f845af43d5f803e5f81036064573d5ffd5b3d5ff3' +
  'fea2646970667358221220bff45c4a53c99683c199ab07d83df93b8a8c07728c' +
  '70439c5514c1b18a159bae64736f6c63430008180033') as `0x${string}`;

/** `keccak256(SAFE_PROXY_CREATION_CODE)`, matching the Foundry test. */
export const SAFE_PROXY_CREATION_CODE_HASH =
  '0x31e47991bd716464184e3ee59819f71d5f5e1fecec59e382e311ca3c9409a7cc' as const;
