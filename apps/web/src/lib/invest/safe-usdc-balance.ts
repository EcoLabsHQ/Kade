import { createPublicClient, erc20Abi, formatUnits, http, type Address } from 'viem';
import { mainnet } from 'viem/chains';
import { USDC_DECIMALS } from './morpho-deposit';

/**
 * The resident Safe's USDC balance on the **deposit chain**, and the gate that
 * refuses a deposit the Safe cannot cover (Week 2, D18 / EXE-014).
 *
 * A MetaMorpho deposit pulls exactly `amount` of USDC from the Safe, so a Safe
 * that holds less than that can never execute the operation. Without this check
 * the app builds the user operation anyway and the only signal is an opaque
 * `eth_estimateUserOperationGas` simulation revert — the resident is told
 * nothing about the one fact that matters. This read is done **before** the
 * operation is built, so an underfunded deposit is refused with a specific,
 * actionable reason instead of reaching the bundler.
 *
 * The Safe is counterfactual until its first user operation deploys it, so the
 * check must not require code at the address: an ERC-20 `balanceOf` is a plain
 * read that works for any address, deployed or not. The USDC contract is the one
 * the app already resolves for the deposit chain (the vault's underlying token,
 * carried on the built plan) — never a second hard-coded copy.
 *
 * A failed read is **not** a pass. It is neither assumed sufficient nor assumed
 * zero (which would wrongly refuse a funded Safe); it is refused with the real
 * read failure, and the two refusals are distinguished by gate.
 */

/** One `balanceOf` read outcome: the raw balance, or the real reason it failed. */
export type SafeUsdcBalanceRead =
  | { readonly status: 'read'; readonly balance: bigint }
  | { readonly status: 'failed'; readonly reason: string };

/** What a balance read targets: the Safe, the deposit chain's USDC, the chain. */
export interface SafeUsdcBalanceInput {
  /** The resident Safe, read by ERC-20 `balanceOf` regardless of deployment. */
  readonly safeAddress: Address;
  /** The vault's underlying USDC on this chain, from the app's own resolution. */
  readonly usdc: Address;
  /** The chain the deposit executes on. */
  readonly chainId: number;
}

/**
 * The read seam. Injected so the gate is unit-testable with no network; defaults
 * to the real Ethereum RPC read.
 */
export type SafeUsdcBalanceReader = (
  input: SafeUsdcBalanceInput,
) => Promise<SafeUsdcBalanceRead>;

/** Why a deposit was refused for funds: too little, or unreadable. */
export type SafeDepositFundingGate =
  | 'safe-insufficient-usdc'
  | 'safe-balance-unreadable';

/**
 * The funding gate's outcome. `ok` means the Safe holds at least the deposit;
 * otherwise the gate and a specific, resident-facing reason are returned.
 */
export type SafeDepositFunding =
  | { readonly ok: true; readonly balance: bigint }
  | {
      readonly ok: false;
      readonly gate: SafeDepositFundingGate;
      readonly reason: string;
    };

/** The funding gate's input: what to read, and what the deposit needs. */
export interface SafeDepositFundingInput extends SafeUsdcBalanceInput {
  /** The chain's human name, so the refusal names where the funds must be. */
  readonly chainName: string;
  /** The deposit amount in USDC's smallest unit, from the built plan. */
  readonly amountUnits: bigint;
}

/** A readable message from an unknown thrown value. */
function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Read the Safe's USDC balance from the Ethereum RPC.
 *
 * Uses the same reserved `ETHEREUM_RPC_URL` the mainnet rail already requires
 * (`isMainnetRailConfigured`) and the same `balanceOf` pattern the vault
 * position read uses. The vault is mainnet-frozen (week-2 §2.2/§6.3), so the
 * mainnet chain definition is the correct one; no chain-specific value is
 * guessed. A missing endpoint or a failed call is a `failed` read, never a
 * fabricated zero.
 */
export async function readSafeUsdcBalanceFromRpc(
  input: SafeUsdcBalanceInput,
): Promise<SafeUsdcBalanceRead> {
  const rpcUrl = process.env.ETHEREUM_RPC_URL?.trim();
  if (!rpcUrl) {
    return {
      status: 'failed',
      reason:
        'the Ethereum RPC endpoint (ETHEREUM_RPC_URL) is not set, so the ' +
        'balance cannot be read',
    };
  }

  try {
    const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
    const balance = await client.readContract({
      address: input.usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [input.safeAddress],
    });
    return { status: 'read', balance };
  } catch (cause) {
    return {
      status: 'failed',
      reason: `the balance read failed: ${reasonOf(cause)}`,
    };
  }
}

/**
 * Check that the Safe can cover `amountUnits` before anything is built.
 *
 * Order, and why:
 *
 *   1. Read the balance. A thrown or `failed` read refuses as
 *      `safe-balance-unreadable` with the real reason — never assumed
 *      sufficient, and never assumed zero.
 *   2. Compare it to the deposit. Less than the amount refuses as
 *      `safe-insufficient-usdc`, naming the chain and the held/needed amounts
 *      (and the shortfall), so the resident knows to move funds in first.
 *
 * The reader is injectable, so every branch is testable with no network.
 */
export async function checkSafeDepositFunding(
  input: SafeDepositFundingInput,
  reader: SafeUsdcBalanceReader = readSafeUsdcBalanceFromRpc,
): Promise<SafeDepositFunding> {
  let read: SafeUsdcBalanceRead;
  try {
    read = await reader(input);
  } catch (cause) {
    read = { status: 'failed', reason: reasonOf(cause) };
  }

  if (read.status === 'failed') {
    return {
      ok: false,
      gate: 'safe-balance-unreadable',
      reason:
        `The Safe's USDC balance on ${input.chainName} could not be read, so ` +
        `the deposit was not built: ${read.reason}.`,
    };
  }

  if (read.balance < input.amountUnits) {
    const held = formatUnits(read.balance, USDC_DECIMALS);
    const needed = formatUnits(input.amountUnits, USDC_DECIMALS);
    const shortfall = formatUnits(input.amountUnits - read.balance, USDC_DECIMALS);
    return {
      ok: false,
      gate: 'safe-insufficient-usdc',
      reason:
        `The Safe holds ${held} USDC on ${input.chainName}, but this deposit ` +
        `needs ${needed} USDC. Move at least ${shortfall} USDC into the Safe ` +
        'before allocating.',
    };
  }

  return { ok: true, balance: read.balance };
}
