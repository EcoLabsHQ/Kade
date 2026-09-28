import type { Address } from 'viem';
import {
  buildMorphoVaultDepositCall,
  InvalidDepositAmountError,
  InvalidSafeAddressError,
  WrongDepositChainError,
  type MorphoVaultDepositPlan,
} from './morpho-deposit';
import { readMorphoVaultConfig, type MorphoEnv } from './morpho-config';

/**
 * The config-gated MetaMorpho vault deposit build path (Week 2, D18 / EXE-014).
 *
 * D18 requires the deposit to be "fully functional end to end: build the call,
 * sign with the passkey (Safe WebAuthn signer), submit, and confirm". This
 * module owns the **build** half: it resolves the server-only vault
 * configuration and builds the plan (`approve` + `deposit`, from
 * `./morpho-deposit.ts`, which is unit-tested against the vault ABI).
 *
 * It never signs and never sends: there is no `writeContract`, no signing and no
 * broadcast here, so no result can claim a deposit happened. The sign-and-submit
 * half is the two-phase passkey flow in `@/app/invest/actions`
 * (`beginDeposit` / `completeDeposit`), which retains the built operation
 * server-side and takes only the browser's assertion.
 *
 * ## There is no signer gate
 *
 * The resident's passkey **is** the Safe owner and nothing needs deploying:
 * Safe's SDK verifies the WebAuthn assertion itself and deploys a counterfactual
 * Safe with its first user operation. The old `signer-not-deployed` gate
 * belonged to the abandoned direct-signer path, where a signer contract had to
 * exist before a signature could validate. It is gone; a signer is always
 * available once the resident holds a credential, and this module no longer
 * takes one.
 *
 * Two project dependencies remain unsupplied (contract §5 and the freeze
 * checklist), so the build is still gated and honest:
 *
 *   1. the MetaMorpho vault address — no `KADE_MORPHO_VAULT_ADDRESS` value;
 *   2. Ethereum mainnet — no RPC rail configured.
 */

/** Why the deposit cannot be built. */
export type VaultDepositGate = 'vault-not-configured' | 'mainnet-not-configured';

/**
 * The outcome of asking to build a deposit.
 *
 * `gated` means the environment refused, and nothing was built against a
 * fabricated value. `ready-to-execute` carries the built plan; it is still
 * unsent — the caller signs and submits it through the two-phase flow — so it
 * is never a deposit.
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
    };

/**
 * The build-time inputs this module reads.
 *
 * There is deliberately no `execute` or `safeExecution` here: building is a pure
 * server-side step with no provider and no signer, and the sign/submit path is
 * the two-phase flow in the server actions rather than an injected callback.
 */
export interface MorphoVaultExecutionDependencies {
  readonly env?: MorphoEnv;
  /** Whether the mainnet rail (RPC) is configured. Defaults to `false`. */
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
 * Build, and only build, a MetaMorpho USDC deposit.
 *
 * Order, and why:
 *
 *   1. Resolve the vault config. Absent → `vault-not-configured`; nothing is
 *      built against a fabricated address.
 *   2. Check the mainnet rail. Absent → `mainnet-not-configured`.
 *   3. Build the plan. A malformed amount, a wrong chain or a bad Safe address is
 *      a refusal, not a sent transaction.
 *
 * Nothing here signs or sends; the caller owns the passkey flow.
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

  return { status: 'ready-to-execute', plan, gated: true };
}
