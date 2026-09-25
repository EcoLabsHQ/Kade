'use server';

import { prepareMorphoVaultDeposit } from '@/lib/invest/morpho-execution';
import type { MorphoVaultDepositResult } from '@/lib/invest/morpho-execution';
import type { MorphoVaultDepositPlan } from '@/lib/invest/morpho-deposit';

/**
 * The Invest server actions (D18 / EXE-014).
 *
 * The browser never holds the vault address, its underlying USDC or the
 * calldata builder's inputs: it asks the server to build the deposit, and the
 * server reads the configuration and returns either a gated outcome or a built
 * plan. This is the same shape the fee rail uses — the treasury and amount are
 * resolved server-side and passed down as values.
 *
 * The build action **does not send**. It calls `prepareMorphoVaultDeposit`, which
 * has no send path and refuses until the vault, mainnet and signer gates are
 * open, so no click here can move funds today.
 */

/** A serialisable summary of the resolved vault, for the page to render. */
export interface InvestVaultSummary {
  readonly configured: boolean;
  readonly chainId: number;
  readonly chainName: string;
  /** The MetaMorpho vault, when configured. */
  readonly vault: string | null;
  /** The vault's underlying USDC, when configured. */
  readonly usdc: string | null;
}

/** What the client receives when it asks to build a deposit. */
export type BuildDepositResult =
  | {
      readonly status: 'gated';
      readonly gate: string;
      readonly reason: string;
    }
  | {
      readonly status: 'ready-to-execute';
      readonly callCount: number;
      /** The two call targets, so the screen can show what would be sent. */
      readonly calls: readonly { readonly to: string; readonly selector: string }[];
      readonly vault: string;
      readonly amountUsdc: string;
    };

/**
 * Build (never send) a MetaMorpho vault deposit for the signed-in resident's
 * Safe.
 *
 * Gate state is passed in by the page, which resolves the vault and the
 * environment. Everything the resident could not be trusted to name — the Safe
 * address, the vault and the calldata — is resolved on the server.
 */
export async function buildDeposit(input: {
  readonly safeAddress: string;
  readonly amountUsdc: string;
  readonly vaultConfigured: boolean;
  readonly mainnetConfigured: boolean;
}): Promise<BuildDepositResult> {
  const result: MorphoVaultDepositResult = await prepareMorphoVaultDeposit(
    { safeAddress: input.safeAddress as `0x${string}`, amountUsdc: input.amountUsdc },
    {
      mainnetConfigured: input.mainnetConfigured,
      // No passkey signer is wired into this build action, so it can only ever
      // return a plan — never a sent transaction.
    },
  );

  if (result.status === 'gated') {
    return { status: 'gated', gate: result.gate, reason: result.reason };
  }
  return summarizePlan(result.plan);
}

function summarizePlan(plan: MorphoVaultDepositPlan): BuildDepositResult {
  return {
    status: 'ready-to-execute',
    callCount: plan.calls.length,
    calls: plan.calls.map((call) => ({ to: call.to, selector: call.data.slice(0, 10) })),
    vault: plan.vault,
    amountUsdc: plan.amountUsdc,
  };
}
