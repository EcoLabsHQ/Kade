import {
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { SAFE_PASSKEY_MODULE } from '@kade/shared';

/**
 * The direct Safe WebAuthn signer deployment path (Week 2 EXE-011).
 *
 * A resident Safe's only owner is a contract the `SafeWebAuthnSignerFactory`
 * deploys on first use, not an EOA. The factory's address is frozen in
 * `@kade/shared`; the signer address is deterministic in the credential's P-256
 * coordinates and the verifier configuration, so `getSigner` can name it before
 * it exists. Until `createSigner` runs, that address has no code and no passkey
 * signature can validate — the gap this module closes.
 *
 * The deployment is an **irreversible on-chain write** and the Week 2 Account
 * gate is not approved, so this module deliberately has **no send path**. It
 * builds the transaction and runs it through the factory's own code with
 * `eth_call` (a simulation), then returns the prepared transaction and the
 * address the factory would create. Broadcasting is left to a post-gate caller.
 *
 * That is not a mock: the simulation executes the deployed factory's
 * `createSigner` against its on-chain code, so the returned address is the one
 * the real call would deploy. Every result is marked `gated: true`, meaning no
 * transaction was sent.
 *
 * `p256Verifiers()` lives here so the signer derivation (`getSigner`) and the
 * signer deployment (`createSigner`) cannot disagree about which verifier the
 * Safe owner commits to; `@/app/onboarding/signer-actions` imports it from here.
 */

/**
 * `SafeWebAuthnSignerFactory` v0.2.1 (safe-modules passkey).
 *
 * Source: `modules/passkey/contracts/SafeWebAuthnSignerFactory.sol`. Both
 * functions take `P256.Verifiers` — a packed `uint176`, not a `uint256` — which
 * is why the third parameter is typed `uint176`.
 */
export const SAFE_WEBAUTHN_SIGNER_FACTORY_ABI = [
  {
    type: 'function',
    name: 'getSigner',
    stateMutability: 'view',
    inputs: [
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
      { name: 'verifiers', type: 'uint176' },
    ],
    outputs: [{ name: 'signer', type: 'address' }],
  },
  {
    type: 'function',
    name: 'createSigner',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
      { name: 'verifiers', type: 'uint176' },
    ],
    outputs: [{ name: 'signer', type: 'address' }],
  },
] as const;

/** The deployed signer factory the Safe owner is derived and deployed through. */
export function signerFactoryAddress(): Address {
  return getAddress(SAFE_PASSKEY_MODULE.safeWebAuthnSignerFactory.value);
}

/**
 * Pack the P-256 verifiers exactly as the module's `P256.Verifiers` expects:
 * a 16-bit EIP-7212 precompile slot above a 160-bit fallback verifier.
 *
 * The precompile slot is zero. Sepolia has no P-256 precompile, and the module
 * treats a zero slot as "no precompile" and falls through to the Solidity
 * verifier, which is what will actually check the signature. This is the one
 * place the packing is computed, so `getSigner` and `createSigner` always agree.
 */
export function p256Verifiers(): bigint {
  const precompile = 0n;
  const fallback = BigInt(SAFE_PASSKEY_MODULE.p256Verifier.value);
  return (precompile << 160n) | fallback;
}

/** An unsigned `createSigner` transaction, ready for a post-gate caller to send. */
export interface PasskeySignerTransaction {
  readonly to: Address;
  readonly data: Hex;
  readonly value: 0n;
}

/**
 * The inputs a signer deployment needs: the credential's P-256 coordinates.
 *
 * `expectedSignerAddress` is optional and, when supplied, is the address the
 * account derivation already committed the Safe owner to. The engine refuses to
 * prepare anything if the factory reports a different one, so the signer that
 * would be deployed and the Safe's owner can never diverge.
 */
export interface PasskeySignerRequest {
  readonly x: bigint;
  readonly y: bigint;
  readonly expectedSignerAddress?: Address;
}

/** Injected so the engine is pure and unit-testable without a network. */
export interface PasskeySignerDependencies {
  readonly publicClient: Pick<
    PublicClient,
    'readContract' | 'getBytecode' | 'simulateContract'
  >;
}

export type PasskeySignerFailureStage = 'derive' | 'simulate';

/**
 * Structured outcome. `gated: true` on every variant is the machine-checkable
 * statement that nothing was broadcast: the engine has no send path, so no
 * result can claim a deployment happened.
 */
export type PreparePasskeySignerResult =
  | {
      readonly status: 'already-deployed';
      readonly signerAddress: Address;
      readonly factory: Address;
      readonly gated: true;
    }
  | {
      readonly status: 'ready-to-deploy';
      readonly signerAddress: Address;
      readonly factory: Address;
      /** What the factory's own `createSigner` returned under simulation. */
      readonly simulated: Address;
      readonly transaction: PasskeySignerTransaction;
      readonly gated: true;
    }
  | {
      readonly status: 'address-mismatch';
      /** The address the Safe's ownership commits to. */
      readonly signerAddress: Address;
      /** What the factory's `getSigner` derives from the coordinates. */
      readonly derived: Address;
      /** What the factory would create, when the simulation got that far. */
      readonly simulated?: Address;
      readonly reason: string;
      readonly gated: true;
    }
  | {
      readonly status: 'failed';
      readonly stage: PasskeySignerFailureStage;
      readonly reason: string;
      readonly gated: true;
    };

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sameAddress(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The `createSigner` calldata for the given coordinates. Nothing is sent. */
export function buildSignerDeployTransaction(
  x: bigint,
  y: bigint,
): PasskeySignerTransaction {
  return {
    to: signerFactoryAddress(),
    data: encodeFunctionData({
      abi: SAFE_WEBAUTHN_SIGNER_FACTORY_ABI,
      functionName: 'createSigner',
      args: [x, y, p256Verifiers()],
    }),
    value: 0n,
  };
}

function mismatch(
  expected: Address,
  derived: Address,
  reason: string,
  simulated?: Address,
): PreparePasskeySignerResult {
  // A mismatch is security-relevant rather than operational: it means the
  // signer the factory would deploy is not the Safe's owner. Log it loudly.
  console.error(`[kade] refusing to prepare the passkey signer: ${reason}`);
  return {
    status: 'address-mismatch',
    signerAddress: expected,
    derived,
    simulated,
    reason,
    gated: true,
  };
}

/**
 * Prepare the resident's direct Safe WebAuthn signer deployment.
 *
 * Order, and why:
 *
 *   1. `getSigner` names the signer from the coordinates. If the caller supplied
 *      the Safe's expected owner and they differ, abort — the signer would not be
 *      the Safe's owner.
 *   2. If the signer already has code, report it and prepare nothing.
 *   3. Simulate `createSigner` and require the address it returns to equal the
 *      derived one. This runs the deployed factory's own code, so it proves the
 *      real call would deploy the same signer the Safe commits to.
 *   4. Return the built transaction, still unsent. The Account gate is closed.
 */
export async function preparePasskeySigner(
  request: PasskeySignerRequest,
  deps: PasskeySignerDependencies,
): Promise<PreparePasskeySignerResult> {
  const factory = signerFactoryAddress();
  const { x, y } = request;
  const verifiers = p256Verifiers();

  // --- 1. Derive the signer address from the factory itself. ----------------
  let derived: Address;
  try {
    const signer = await deps.publicClient.readContract({
      address: factory,
      abi: SAFE_WEBAUTHN_SIGNER_FACTORY_ABI,
      functionName: 'getSigner',
      args: [x, y, verifiers],
    });
    derived = getAddress(signer);
  } catch (error) {
    return {
      status: 'failed',
      stage: 'derive',
      reason: `could not read getSigner(...) from the factory ${factory}: ${describe(error)}`,
      gated: true,
    };
  }

  if (
    request.expectedSignerAddress !== undefined &&
    !sameAddress(derived, getAddress(request.expectedSignerAddress))
  ) {
    return mismatch(
      getAddress(request.expectedSignerAddress),
      derived,
      `the factory derives signer ${derived}, but the Safe's ownership expects ` +
        `${getAddress(request.expectedSignerAddress)}. Deploying would create a ` +
        `signer the Safe does not own.`,
    );
  }

  // --- 2. Idempotency: `createSigner` is itself idempotent, but a signer that
  //        already has code needs no transaction at all. ----------------------
  let existingCode: Hex | undefined;
  try {
    existingCode = await deps.publicClient.getBytecode({ address: derived });
  } catch (error) {
    return {
      status: 'failed',
      stage: 'derive',
      reason: `could not read the code at ${derived}: ${describe(error)}`,
      gated: true,
    };
  }
  if (existingCode !== undefined && existingCode !== '0x') {
    return {
      status: 'already-deployed',
      signerAddress: derived,
      factory,
      gated: true,
    };
  }

  // --- 3. Simulate the real call and compare what it would deploy. ----------
  let simulated: Address;
  try {
    const simulation = await deps.publicClient.simulateContract({
      address: factory,
      abi: SAFE_WEBAUTHN_SIGNER_FACTORY_ABI,
      functionName: 'createSigner',
      args: [x, y, verifiers],
    });
    if (!simulation.result) {
      return {
        status: 'failed',
        stage: 'simulate',
        reason:
          'the factory simulation returned no signer address, so the created address cannot be confirmed.',
        gated: true,
      };
    }
    simulated = getAddress(simulation.result);
  } catch (error) {
    return {
      status: 'failed',
      stage: 'simulate',
      reason: `createSigner would revert: ${describe(error)}`,
      gated: true,
    };
  }
  if (!sameAddress(simulated, derived)) {
    return mismatch(
      request.expectedSignerAddress
        ? getAddress(request.expectedSignerAddress)
        : derived,
      derived,
      `the factory would create ${simulated}, not the derived ${derived}. ` +
        `The signer deployment inputs are not the ones the owner was derived from.`,
      simulated,
    );
  }

  // --- 4. Prepared, not sent. -----------------------------------------------
  return {
    status: 'ready-to-deploy',
    signerAddress: derived,
    factory,
    simulated,
    transaction: buildSignerDeployTransaction(x, y),
    gated: true,
  };
}
