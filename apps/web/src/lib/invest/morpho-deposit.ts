import {
  encodeFunctionData,
  erc20Abi,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { METAMORPHO_VAULT_ABI } from './morpho-abi';
import type { MorphoVaultConfig } from './morpho-config';

/**
 * The MetaMorpho vault deposit call path (Week 2, D18 / EXE-014).
 *
 * A resident deposits USDC into one MetaMorpho vault on Ethereum mainnet. The
 * deposit is two calls:
 *
 *   1. `USDC.approve(vault, amount)` — let the vault pull the resident's USDC.
 *   2. `vault.deposit(amount, safe)` — deposit `amount` of the underlying USDC
 *      and mint the vault shares to `receiver`.
 *
 * They are built for a **Safe** (ERC-4337 / Safe transaction), so the caller
 * signs once with the passkey (Safe WebAuthn signer) and executes both.
 * `receiver` is the resident Safe, so the vault shares are theirs; the Safe is
 * the `msg.sender` the vault pulls the USDC from, which is why the `approve`
 * must originate from the same Safe account.
 *
 * Because `deposit` is assets-denominated (ERC-4626), exactly `amount` of USDC
 * is taken, so a deposit cannot move less than the resident approved.
 *
 * This module **builds** the calls and never sends them. There is no
 * `writeContract`, no signing and no broadcast here: the Week 2 Onchain gate is
 * not approved, the vault address and mainnet are not supplied, and the Safe
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
export interface MorphoVaultCall {
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

/** Raised when a caller names a chain other than the configured vault's. */
export class WrongDepositChainError extends Error {
  constructor(expected: number, actual: number) {
    super(
      `The MetaMorpho vault is configured on chain ${expected}, but the call ` +
        `was built for chain ${actual}. A deposit on another chain would target ` +
        'a vault that does not exist there.',
    );
    this.name = 'WrongDepositChainError';
  }
}

/** Raised when `receiver` is not a usable Safe address. */
export class InvalidSafeAddressError extends Error {
  constructor(value: string) {
    super(`The Safe address must be a 20-byte hex address, got "${value}".`);
    this.name = 'InvalidSafeAddressError';
  }
}

export interface BuildMorphoVaultDepositInput {
  /** The configured vault: the vault address, its USDC and the chain id. */
  readonly config: MorphoVaultConfig;
  /** The resident Safe that holds the USDC and will own the vault shares. */
  readonly safeAddress: Address;
  /** The deposit, as a whole-USDC decimal string (e.g. "25000" or "1500.5"). */
  readonly amountUsdc: string;
  /**
   * The chain the transaction will execute on. When supplied it must equal the
   * configured vault's chain; this is the guard that keeps a mainnet-frozen
   * vault from being called on a testnet.
   */
  readonly chainId?: number;
}

/**
 * The built, unsigned deposit: the ordered calls and the resolved figures.
 *
 * `calls` is exactly what a Safe `MultiSend`/UserOp would execute, in order:
 * `approve` then `deposit`. Nothing here is signed or sent.
 */
export interface MorphoVaultDepositPlan {
  readonly chainId: number;
  /** The MetaMorpho vault the shares come from. */
  readonly vault: Address;
  readonly safeAddress: Address;
  /** Whole USDC as supplied, normalised by `parseUnits`/`formatUnits`. */
  readonly amountUsdc: string;
  /** The amount in USDC's smallest unit, for `approve` and `deposit`. */
  readonly amountUnits: bigint;
  /** `USDC.approve(vault, amountUnits)`. */
  readonly approve: MorphoVaultCall;
  /** `vault.deposit(amountUnits, safe)`. */
  readonly deposit: MorphoVaultCall;
  readonly calls: readonly [MorphoVaultCall, MorphoVaultCall];
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
 * Build the two Calls for a MetaMorpho USDC deposit, without signing or sending.
 *
 * Pure and deterministic: given the same configuration and amount it returns the
 * same calldata, which is what makes the calldata testable against the vault ABI
 * with no network.
 */
export function buildMorphoVaultDepositCall(
  input: BuildMorphoVaultDepositInput,
): MorphoVaultDepositPlan {
  const { config } = input;
  if (input.chainId !== undefined && input.chainId !== config.chainId) {
    throw new WrongDepositChainError(config.chainId, input.chainId);
  }

  const safeAddress = assertSafeAddress(input.safeAddress);
  const amountUnits = parseAmount(input.amountUsdc);

  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [config.vault, amountUnits],
  });

  const depositData = encodeFunctionData({
    abi: METAMORPHO_VAULT_ABI,
    functionName: 'deposit',
    args: [amountUnits, safeAddress],
  });

  const approve: MorphoVaultCall = {
    to: config.usdc,
    value: 0n,
    data: approveData,
  };
  const deposit: MorphoVaultCall = {
    to: config.vault,
    value: 0n,
    data: depositData,
  };

  return {
    chainId: config.chainId,
    vault: config.vault,
    safeAddress,
    amountUsdc: input.amountUsdc.trim(),
    amountUnits,
    approve,
    deposit,
    calls: [approve, deposit],
  };
}
