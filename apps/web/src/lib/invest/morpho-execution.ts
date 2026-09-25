import type { Address, Hex } from 'viem';
import {
  buildMorphoVaultDepositCall,
  InvalidDepositAmountError,
  InvalidSafeAddressError,
  WrongDepositChainError,
  type MorphoVaultDepositPlan,
} from './morpho-deposit';
import { readMorphoVaultConfig, type MorphoEnv } from './morpho-config';
import {
  executeSafeTransaction,
  type SafeExecutionDependencies,
  type SafeExecutionOutcome,
  type SafePasskeyReference,
} from '../safe/execute';

/**
 * The config-gated MetaMorpho vault deposit execution path (Week 2, D18 /
 * EXE-014).
 *
 * D18 requires the deposit to be "fully functional end to end: build the call,
 * sign with the passkey (Safe WebAuthn signer), submit, and confirm". Three
 * project dependencies are **not supplied** (contract §5 and the freeze
 * checklist), so the execution boundary is gated and honest:
 *
 *   1. the MetaMorpho vault address — no `KADE_MORPHO_VAULT_ADDRESS` value;
 *   2. Ethereum mainnet — no RPC, payer or treasury;
 *   3. the direct Safe WebAuthn signer — not deployed (`docs/known-gaps.md`,
 *      D-EXE-011), so a passkey signature cannot validate.
 *
 * This module therefore **builds** the plan (from `./morpho-deposit.ts`, which is
 * unit-tested against the vault ABI) and then **refuses to execute**, returning a
 * machine-checkable `gated: true` outcome naming the missing dependency. It has
 * no send path: there is no `writeContract`, no signing and no broadcast, so no
 * result can claim a deposit happened. That is the same shape front 01's signer
 * preparation uses for its closed Account gate.
 *
 * When the gate opens, the caller supplies a Safe execution callback
 * (`execute`) — the ERC-4337 / Safe transaction submission that signs with the
 * passkey. This module is where that callback would be invoked; wiring it is
 * deliberately left until the vault, mainnet and signer exist, so nothing here
 * pretends the half that cannot run is done.
 *
 * The seam is now connected: instead of the opaque `execute` callback, a caller
 * may supply `safeExecution`, the injected dependencies of the resident-Safe
 * engine (`../safe/execute`). The plan's `calls` are then handed to
 * `executeSafeTransaction`, which is itself fail-closed on the Onchain gate and
 * sends nothing unless it is given a signer and a submitter. A confirmed send is
 * a distinct `sent: true` variant; the plan is never reported as a deposit.
 */

/** Why execution is refused. `vault`/`mainnet`/`signer` are the three gates. */
export type VaultDepositGate =
  | 'vault-not-configured'
  | 'mainnet-not-configured'
  | 'signer-not-deployed'
  /** The resident-Safe engine refused: its own gate, signer or deps. */
  | 'execution-blocked';

/**
 * The outcome of asking to execute a deposit.
 *
 * A `gated`/`ready-to-execute` result is unsent (`gated: true` means the plan was
 * built but nothing was sent; `ready-to-execute` carries the plan and, when the
 * engine was wired in, the engine's own unsent outcome). A `sent` result is a
 * confirmed on-chain deposit with a transaction hash. The two can never be
 * confused.
 */
export type MorphoVaultDepositResult =
  | {
      readonly status: 'gated';
      readonly gate: VaultDepositGate;
      readonly reason: string;
      /** The plan that would be executed, when configuration was complete. */
      readonly plan?: MorphoVaultDepositPlan;
      readonly gated: true;
    }
  | {
      readonly status: 'ready-to-execute';
      readonly plan: MorphoVaultDepositPlan;
      readonly gated: true;
      /** The engine's own outcome, when the engine was wired in. */
      readonly execution?: SafeExecutionOutcome;
    }
  | {
      /** A confirmed on-chain deposit. Only after a successful receipt. */
      readonly status: 'sent';
      readonly sent: true;
      readonly plan: MorphoVaultDepositPlan;
      readonly transactionHash: Hex;
      readonly userOperationHash: Hex;
      readonly gated: false;
      readonly reason: string;
    };

/** The gate-approved Safe execution callback, injected only post-gate. */
export interface MorphoVaultExecutionDependencies {
  /**
   * Submit the built calls as one Safe transaction, signed with the passkey.
   *
   * Supplied by a post-gate caller. Absent by default, which is what keeps this
   * module from sending anything today.
   */
  readonly execute?: (
    plan: MorphoVaultDepositPlan,
  ) => Promise<{ readonly txHash: `0x${string}` }>;
  /**
   * The resident-Safe engine's injected dependencies. When `execute` is absent
   * and this is supplied, the plan's calls are executed through
   * `executeSafeTransaction`, which enforces its own approval gate and sends
   * nothing unless a signer and submitter are supplied.
   */
  readonly safeExecution?: SafeExecutionDependencies;
  /** The passkey the Safe engine signs with, when the engine is wired in. */
  readonly credential?: SafePasskeyReference;
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

export interface MorphoVaultDepositRequest {
  readonly safeAddress: Address;
  readonly amountUsdc: string;
  readonly chainId?: number;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Prepare, and only prepare, a MetaMorpho USDC deposit.
 *
 * Order, and why:
 *
 *   1. Resolve the vault config. Absent → `vault-not-configured`; nothing is
 *      built against a fabricated address.
 *   2. Check the mainnet rail. Absent → `mainnet-not-configured`.
 *   3. Check the Safe WebAuthn signer. Not deployed → `signer-not-deployed`. The
 *      passkey cannot authorise a Safe transaction without it, so a plan built
 *      here could never be signed.
 *   4. Build the plan. A malformed amount, a wrong chain or a bad Safe address is
 *      a failure, not a gate.
 *   5. Only when a gate-approved `execute` callback is present does this invoke
 *      it. Today it never is, so no result here can describe a sent transaction.
 */
export async function prepareMorphoVaultDeposit(
  request: MorphoVaultDepositRequest,
  deps: MorphoVaultExecutionDependencies = {},
): Promise<MorphoVaultDepositResult> {
  const env = deps.env ?? process.env;
  const config = readMorphoVaultConfig(env);
  if (!config) {
    return {
      status: 'gated',
      gate: 'vault-not-configured',
      reason:
        'No MetaMorpho vault is configured. Set the KADE_MORPHO_VAULT_ADDRESS ' +
        'and KADE_MORPHO_USDC_ADDRESS variables to the approved Ethereum-mainnet ' +
        'vault before a deposit can be built.',
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

  let plan: MorphoVaultDepositPlan;
  try {
    plan = buildMorphoVaultDepositCall({
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
        gate: 'vault-not-configured',
        reason: describe(error),
        gated: true,
      };
    }
    throw error;
  }

  const execute = deps.execute;
  if (execute) {
    // A post-gate caller supplied the opaque callback. It owns the Safe
    // submission; this module still reports only that the plan is ready.
    await execute(plan);
    return { status: 'ready-to-execute', plan, gated: true };
  }

  const safeExecution = deps.safeExecution;
  if (!safeExecution) {
    // Every gate is open and the plan is built, but no callback or engine is
    // wired: this is the honest "ready, not sent" state. Nothing was broadcast.
    return { status: 'ready-to-execute', plan, gated: true };
  }

  // Route the plan's exact calls through the resident-Safe engine. The engine
  // enforces the Onchain approval gate and, absent a signer/submitter, stops at
  // its own reviewable plan; a `sent: true` means a confirmed receipt.
  const outcome = await executeSafeTransaction(
    {
      calls: plan.calls,
      safeAddress: plan.safeAddress,
      chainId: plan.chainId,
      credential: deps.credential,
    },
    safeExecution,
  );

  if (outcome.status === 'sent') {
    return {
      status: 'sent',
      sent: true,
      plan,
      transactionHash: outcome.transactionHash,
      userOperationHash: outcome.userOperationHash,
      gated: false,
      reason: outcome.reason,
    };
  }

  if (outcome.status === 'plan') {
    return { status: 'ready-to-execute', plan, gated: true, execution: outcome };
  }

  return {
    status: 'gated',
    gate: 'execution-blocked',
    reason: outcome.reason,
    plan,
    gated: true,
  };
}
