import {
  encodeFunctionData,
  erc20Abi,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { MORPHO_BLUE_ABI, marketParamsTuple } from './morpho-abi';
import type { MorphoPoolConfig } from './morpho-config';

/**
 * The Morpho deposit call path (Week 2, D18 / EXE-014).
 *
 * A resident deposits USDC into one Morpho Blue market on Ethereum mainnet. The
 * deposit is two calls:
 *
 *   1. `USDC.approve(morpho, amount)` — let Morpho pull the resident's USDC.
 *   2. `Morpho.supply(marketParams, amount, 0, onBehalf, 0x)` — supply `amount`
 *      of the loan token and credit the position to `onBehalf`.
 *
 * They are built for a **Safe** (ERC-4337 / Safe transaction), so the caller
 * signs once with the passkey (Safe WebAuthn signer) and executes both. `onBehalf`
 * is the resident Safe, so the position is theirs; the Safe is the `msg.sender`
 * Morpho pulls the USDC from, which is why the `approve` must originate from the
 * same Safe account.
 *
 * `shares = 0` makes the supply assets-denominated: exactly `amount` of USDC is
 * taken, with no share-price slippage, so a deposit cannot supply less than the
 * resident approved.
 *
 * This module **builds** the calls and never sends them. There is no
 * `writeContract`, no signing and no broadcast here: the Week 2 Onchain gate is
 * not approved, the pool address and mainnet are not supplied, and the Safe
 * WebAuthn signer is not deployed (D-EXE-011). Execution is config-gated and
 * lives behind `./morpho-execution.ts`, which refuses until those land.
 *
 * The amount is supplied by the caller as a whole-USDC decimal string (the server
 * resolves it from vault USDC) and converted here with USDC's 6 decimals.
 */

/** USDC has six decimals. */
export const USDC_DECIMALS = 6;

const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** One contract call of the batched Safe transaction. */
export interface MorphoCall {
  readonly to: Address;
  readonly value: 0n;
  readonly data: Hex;
}

/** Raised when the deposit amount is not a positive USDC decimal. */
export class InvalidDepositAmountError extends Error {
  constructor(value: string) {
    super(
      `The deposit amount must be a positive USDC decimal with at most ${USDC_DECIMALS} ` +
        `places, got "${value}".`,
    );
    this.name = 'InvalidDepositAmountError';
  }
}

/** Raised when a caller names a chain other than the configured pool's. */
export class WrongDepositChainError extends Error {
  constructor(expected: number, actual: number) {
    super(
      `The Morpho pool is configured on chain ${expected}, but the call was ` +
        `built for chain ${actual}. A deposit on another chain would target a ` +
        'market that does not exist there.',
    );
    this.name = 'WrongDepositChainError';
  }
}

/** Raised when `onBehalf` is not a usable Safe address. */
export class InvalidSafeAddressError extends Error {
  constructor(value: string) {
    super(`The Safe address must be a 20-byte hex address, got "${value}".`);
    this.name = 'InvalidSafeAddressError';
  }
}

export interface BuildDepositInput {
  /** The configured pool: Morpho address, chain id and market parameters. */
  readonly config: MorphoPoolConfig;
  /** The resident Safe that holds the USDC and will own the position. */
  readonly safeAddress: Address;
  /** The deposit, as a whole-USDC decimal string (e.g. "25000" or "1500.5"). */
  readonly amountUsdc: string;
  /**
   * The chain the transaction will execute on. When supplied it must equal the
   * configured pool's chain; this is the guard that keeps a mainnet-frozen pool
   * from being called on a testnet.
   */
  readonly chainId?: number;
}

/**
 * The built, unsigned deposit: the ordered calls and the resolved figures.
 *
 * `calls` is exactly what a Safe `MultiSend`/UserOp would execute, in order:
 * `approve` then `supply`. Nothing here is signed or sent.
 */
export interface MorphoDepositPlan {
  readonly chainId: number;
  readonly morpho: Address;
  readonly safeAddress: Address;
  readonly marketId: Hex;
  /** Whole USDC as supplied, normalised by `parseUnits`/`formatUnits`. */
  readonly amountUsdc: string;
  /** The amount in USDC's smallest unit, for `approve` and `supply`. */
  readonly amountUnits: bigint;
  /** `USDC.approve(morpho, amountUnits)`. */
  readonly approve: MorphoCall;
  /** `Morpho.supply(marketParams, amountUnits, 0, safe, 0x)`. */
  readonly supply: MorphoCall;
  readonly calls: readonly [MorphoCall, MorphoCall];
}

function assertSafeAddress(value: string): Address {
  if (!ADDRESS_PATTERN.test(value)) {
    throw new InvalidSafeAddressError(value);
  }
  return value as Address;
}

function parseAmount(amountUsdc: string): bigint {
  if (!AMOUNT_PATTERN.test(amountUsdc.trim())) {
    throw new InvalidDepositAmountError(amountUsdc);
  }
  const units = parseUnits(amountUsdc.trim(), USDC_DECIMALS);
  if (units <= 0n) {
    throw new InvalidDepositAmountError(amountUsdc);
  }
  return units;
}

/**
 * Build the two Calls for a Morpho USDC deposit, without signing or sending.
 *
 * Pure and deterministic: given the same configuration and amount it returns the
 * same calldata, which is what makes the calldata testable against the Morpho ABI
 * with no network.
 */
export function buildMorphoDepositCall(input: BuildDepositInput): MorphoDepositPlan {
  const { config } = input;
  if (input.chainId !== undefined && input.chainId !== config.chainId) {
    throw new WrongDepositChainError(config.chainId, input.chainId);
  }

  const safeAddress = assertSafeAddress(input.safeAddress);
  const amountUnits = parseAmount(input.amountUsdc);

  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [config.morpho, amountUnits],
  });

  const supplyData = encodeFunctionData({
    abi: MORPHO_BLUE_ABI,
    functionName: 'supply',
    args: [
      marketParamsTuple(config.marketParams),
      amountUnits,
      0n,
      safeAddress,
      '0x',
    ],
  });

  const approve: MorphoCall = {
    to: config.marketParams.loanToken,
    value: 0n,
    data: approveData,
  };
  const supply: MorphoCall = {
    to: config.morpho,
    value: 0n,
    data: supplyData,
  };

  return {
    chainId: config.chainId,
    morpho: config.morpho,
    safeAddress,
    marketId: config.marketId,
    amountUsdc: input.amountUsdc.trim(),
    amountUnits,
    approve,
    supply,
    calls: [approve, supply],
  };
}
