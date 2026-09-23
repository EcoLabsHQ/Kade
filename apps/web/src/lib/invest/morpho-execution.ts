import type { Address } from 'viem';
import {
  buildMorphoDepositCall,
  InvalidDepositAmountError,
  InvalidSafeAddressError,
  WrongDepositChainError,
  type MorphoDepositPlan,
} from './morpho-deposit';
import { readMorphoPoolConfig, type MorphoEnv } from './morpho-config';

/**
 * The config-gated Morpho deposit execution path (Week 2, D18 / EXE-014).
 *
 * D18 requires the deposit to be "fully functional end to end: build the call,
 * sign with the passkey (Safe WebAuthn signer), submit, and confirm". Three
 * project dependencies are **not supplied** (contract §5 and the freeze
 * checklist), so the execution boundary is gated and honest:
 *
 *   1. the Morpho pool address / market parameters — no `KADE_MORPHO_*` value;
 *   2. Ethereum mainnet — no RPC, payer or treasury;
 *   3. the direct Safe WebAuthn signer — not deployed (`docs/known-gaps.md`,
 *      D-EXE-011), so a passkey signature cannot validate.
 *
 * This module therefore **builds** the plan (from `./morpho-deposit.ts`, which is
 * unit-tested against the Morpho ABI) and then **refuses to execute**, returning a
 * machine-checkable `gated: true` outcome naming the missing dependency. It has
 * no send path: there is no `writeContract`, no signing and no broadcast, so no
 * result can claim a deposit happened. That is the same shape front 01's signer
 * preparation uses for its closed Account gate.
 *
 * When the gate opens, the caller supplies a Safe execution callback
 * (`execute`) — the ERC-4337 / Safe transaction submission that signs with the
 * passkey. This module is where that callback would be invoked; wiring it is
 * deliberately left until the pool, mainnet and signer exist, so nothing here
 * pretends the half that cannot run is done.
 */

/** Why execution is refused. `pool`/`mainnet`/`signer` are the three gates. */
export type DepositGate =
  | 'pool-not-configured'
  | 'mainnet-not-configured'
  | 'signer-not-deployed';

/**
 * The outcome of asking to execute a deposit.
 *
 * `gated: true` is on every variant, including `ready-to-execute`: it means the
 * plan was built but nothing was sent. `ready-to-execute` is the only variant
 * that carries a plan, and it still requires the gate-approved callback to be
 * supplied before anything happens.
 */
export type MorphoDepositResult =
  | {
      readonly status: 'gated';
      readonly gate: DepositGate;
      readonly reason: string;
      /** The plan that would be executed, when configuration was complete. */
      readonly plan?: MorphoDepositPlan;
      readonly gated: true;
    }
  | {
      readonly status: 'ready-to-execute';
      readonly plan: MorphoDepositPlan;
      readonly gated: true;
    };

/** The gate-approved Safe execution callback, injected only post-gate. */
export interface MorphoExecutionDependencies {
  /**
   * Submit the built calls as one Safe transaction, signed with the passkey.
   *
   * Supplied by a post-gate caller. Absent by default, which is what keeps this
   * module from sending anything today.
   */
  readonly execute?: (plan: MorphoDepositPlan) => Promise<{ readonly txHash: `0x${string}` }>;
  readonly env?: MorphoEnv;
  /**
   * Whether the Safe WebAuthn signer has code on chain. Defaults to `false`
   * because the signer is not deployed (D-EXE-011); a post-gate caller that has
   * verified code passes `true`.
   */
  readonly signerDeployed?: boolean;
  /** Whether the mainnet rail (RPC/payer) is configured. Defaults to `false`. */
  readonly mainnetConfigured?: boolean;
}

export interface MorphoDepositRequest {
  readonly safeAddress: Address;
  readonly amountUsdc: string;
  readonly chainId?: number;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Prepare, and only prepare, a Morpho USDC deposit.
 *
 * Order, and why:
 *
 *   1. Resolve the pool config. Absent → `pool-not-configured`; nothing is built
 *      against a fabricated address.
 *   2. Check the mainnet rail. Absent → `mainnet-not-configured`.
 *   3. Check the Safe WebAuthn signer. Not deployed → `signer-not-deployed`. The
 *      passkey cannot authorise a Safe transaction without it, so a plan built
 *      here could never be signed.
 *   4. Build the plan. A malformed amount, a wrong chain or a bad Safe address is
 *      a failure, not a gate.
 *   5. Only when a gate-approved `execute` callback is present does this invoke
 *      it. Today it never is, so no result here can describe a sent transaction.
 */
export async function prepareMorphoDeposit(
  request: MorphoDepositRequest,
  deps: MorphoExecutionDependencies = {},
): Promise<MorphoDepositResult> {
  const env = deps.env ?? process.env;
  const config = readMorphoPoolConfig(env);
  if (!config) {
    return {
      status: 'gated',
      gate: 'pool-not-configured',
      reason:
        'No Morpho pool is configured. Set the KADE_MORPHO_* variables to the ' +
        'approved Ethereum-mainnet market before a deposit can be built.',
      gated: true,
    };
  }

  if (!deps.mainnetConfigured) {
    return {
      status: 'gated',
      gate: 'mainnet-not-configured',
      reason:
        'The Ethereum-mainnet rail is not configured (no RPC/payer). The ' +
        'deposit cannot be submitted until mainnet funding is supplied.',
      gated: true,
    };
  }

  if (!deps.signerDeployed) {
    return {
      status: 'gated',
      gate: 'signer-not-deployed',
      reason:
        'The direct Safe WebAuthn signer is not deployed, so a passkey ' +
        'signature cannot authorise the Safe transaction (D-EXE-011).',
      gated: true,
    };
  }

  let plan: MorphoDepositPlan;
  try {
    plan = buildMorphoDepositCall({
      config,
      safeAddress: request.safeAddress,
      amountUsdc: request.amountUsdc,
      chainId: request.chainId,
    });
  } catch (error) {
    if (
      error instanceof InvalidDepositAmountError ||
      error instanceof InvalidSafeAddressError ||
      error instanceof WrongDepositChainError
    ) {
      return {
        status: 'gated',
        gate: 'pool-not-configured',
        reason: describe(error),
        gated: true,
      };
    }
    throw error;
  }

  const execute = deps.execute;
  if (!execute) {
    // Every gate is open and the plan is built, but no callback is wired: this
    // is the honest "ready, not sent" state. Nothing was broadcast.
    return { status: 'ready-to-execute', plan, gated: true };
  }

  // Reaching here requires a post-gate caller that supplied `execute`. The
  // callback owns the Safe transaction submission and the passkey signature.
  await execute(plan);
  return { status: 'ready-to-execute', plan, gated: true };
}
