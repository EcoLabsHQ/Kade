import {
  concat,
  encodeAbiParameters,
  getAddress,
  keccak256,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem';

/**
 * Deterministic Safe address derivation (D4), in TypeScript.
 *
 * The same arithmetic lives in `packages/contracts/src/SafeAddress.sol`, which is
 * Foundry-tested and pins a known vector. This is the browser-side mirror, so
 * the UI can show the address the contracts would produce rather than calling
 * the chain. A test cross-checks it against viem's own CREATE2 implementation.
 *
 * D4 uses the chain-agnostic `SafeProxyFactory.createProxyWithNonce`, whose salt
 * does not include the chain id, which is what makes one address valid on every
 * chain. `createChainSpecificProxyWithNonce` is deliberately not modelled: it
 * would produce a different address per chain.
 *
 * Nothing here deploys. The factory, singleton and fallback handler come from
 * `@kade/shared` (Safe's own published deployments). The signer address and the
 * proxy creation code are inputs, read from the deploying contracts, because
 * neither can be reproduced locally — see `./account.ts`.
 */

export interface SafeDerivationInputs {
  readonly factory: Address;
  readonly singleton: Address;
  readonly initializerHash: Hex;
  readonly saltNonce: bigint;
  /** `SafeProxy` creation code for the pinned Safe version. */
  readonly proxyCreationCode: Hex;
}

function toWord(value: bigint): Hex {
  return encodeAbiParameters([{ type: 'uint256' }], [value]);
}

/** `keccak256(proxyCreationCode ++ uint256(uint160(singleton)))`. */
export function proxyInitCodeHash(
  proxyCreationCode: Hex,
  singleton: Address,
): Hex {
  return keccak256(concat([proxyCreationCode, toWord(BigInt(singleton))]));
}

/** `keccak256(initializerHash ++ uint256(saltNonce))`. */
export function safeSalt(initializerHash: Hex, saltNonce: bigint): Hex {
  return keccak256(concat([initializerHash, toWord(saltNonce)]));
}

export function predictSafeAddress(inputs: SafeDerivationInputs): Address {
  if (inputs.factory === zeroAddress) {
    throw new Error('A zero factory can never deploy the proxy.');
  }
  const initCodeHash = proxyInitCodeHash(
    inputs.proxyCreationCode,
    inputs.singleton,
  );
  const salt = safeSalt(inputs.initializerHash, inputs.saltNonce);
  const digest = keccak256(
    concat(['0xff', inputs.factory, salt, initCodeHash]),
  );
  // EIP-55: an address shown to a person should be checksummed, so a typo is
  // visible rather than silently valid.
  return getAddress(`0x${digest.slice(-40)}`);
}

const SAFE_SETUP_SELECTOR = toFunctionSelector(
  'setup(address[],uint256,address,bytes,address,address,uint256,address)',
);

export interface SafeInitializerParams {
  /** The Safe's owners. Week 1: exactly one, the passkey signer. */
  readonly owners: readonly Address[];
  readonly threshold: number;
  readonly fallbackHandler: Address;
}

/**
 * The `setup` calldata a 1-of-1 WebAuthn-owned Safe is initialised with.
 *
 * The initializer is what the address commits to, so it is built here rather
 * than inline: the owner list, the threshold and the fallback handler all change
 * the resulting address, which is why D4 requires them to be frozen.
 */
export function safeInitializer(params: SafeInitializerParams): Hex {
  return concat([
    SAFE_SETUP_SELECTOR,
    encodeAbiParameters(
      [
        { type: 'address[]' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'address' },
      ],
      [
        [...params.owners],
        BigInt(params.threshold),
        zeroAddress,
        '0x',
        params.fallbackHandler,
        zeroAddress,
        0n,
        zeroAddress,
      ],
    ),
  ]);
}

export function initializerHash(params: SafeInitializerParams): Hex {
  return keccak256(safeInitializer(params));
}
