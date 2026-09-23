'use server';

import { prepareMorphoDeposit } from '@/lib/invest/morpho-execution';
import type { MorphoDepositResult } from '@/lib/invest/morpho-execution';
import type { MorphoDepositPlan } from '@/lib/invest/morpho-deposit';

/**
 * The Invest server actions (D18 / EXE-014).
 *
 * The browser never holds the pool address, the market parameters or the calldata
 * builder's inputs: it asks the server to build the deposit, and the server
 * reads the configuration and returns either a gated outcome or a built plan.
 * This is the same shape the fee rail uses — the treasury and amount are resolved
 * server-side and passed down as values.
 *
 * The build action **does not send**. It calls `prepareMorphoDeposit`, which has
 * no send path and refuses until the pool, mainnet and signer gates are open, so
 * no click here can move funds today.
 */

/** A serialisable summary of the resolved pool, for the page to render. */
export interface InvestPoolSummary {
  readonly configured: boolean;
  readonly chainId: number;
  readonly chainName: string;
  /** The USDC loan token, when configured. */
  readonly loanToken: string | null;
  /** The Morpho Blue contract, when configured. */
  readonly morpho: string | null;
  /** The market id, when configured. */
  readonly marketId: string | null;
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
      readonly marketId: string;
      readonly amountUsdc: string;
    };

/**
 * Build (never send) a Morpho deposit for the signed-in resident's Safe.
 *
 * Gate state is passed in by the page, which resolves the pool and the
 * environment. Everything the resident could not be trusted to name — the Safe
 * address, the market and the calldata — is resolved on the server.
 */
export async function buildDeposit(input: {
  readonly safeAddress: string;
  readonly amountUsdc: string;
  readonly poolConfigured: boolean;
  readonly mainnetConfigured: boolean;
  readonly signerDeployed: boolean;
}): Promise<BuildDepositResult> {
  const result: MorphoDepositResult = await prepareMorphoDeposit(
    { safeAddress: input.safeAddress as `0x${string}`, amountUsdc: input.amountUsdc },
    {
      mainnetConfigured: input.mainnetConfigured,
      signerDeployed: input.signerDeployed,
      // No execute callback: the Onchain gate is not approved, so this build
      // can only ever return a plan, never a sent transaction.
    },
  );

  if (result.status === 'gated') {
    return { status: 'gated', gate: result.gate, reason: result.reason };
  }
  return summarizePlan(result.plan);
}

function summarizePlan(plan: MorphoDepositPlan): BuildDepositResult {
  return {
    status: 'ready-to-execute',
    callCount: plan.calls.length,
    calls: plan.calls.map((call) => ({ to: call.to, selector: call.data.slice(0, 10) })),
    marketId: plan.marketId,
    amountUsdc: plan.amountUsdc,
  };
}
