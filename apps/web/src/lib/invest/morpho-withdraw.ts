import {
  encodeFunctionData,
  parseUnits,
  type Address,
} from 'viem';
import { METAMORPHO_VAULT_ABI } from './morpho-abi';
import {
  InvalidSafeAddressError,
  USDC_DECIMALS,
  type MorphoVaultCall,
} from './morpho-deposit';
import type { MorphoVaultConfig } from './morpho-config';

/**
 * The MetaMorpho vault **un-allocate** call path (the inverse of a deposit).
 *
 * The resident Safe already holds the vault's ERC-4626 shares, so taking USDC
 * back out is a **single** call from the Safe — no `approve` is needed, because
 * redemption draws on the Safe's own shares rather than on an allowance:
 *
 *   - `withdraw(assets, receiver, owner)` — burn the shares needed for exactly
 *     `assets` USDC and send `assets` to `receiver`. Used for a **stated** USDC
 *     amount (a partial un-allocate).
 *   - `redeem(shares, receiver, owner)` — burn exactly `shares` and send the
 *     resulting USDC to `receiver`. Used for **"all"**, so no dust share is left
 *     behind that could not later be withdrawn (a dust share worth less than one
 *     USDC unit could otherwise strand value).
 *
 * In both, `owner` is the Safe whose shares are burned and `receiver` is the
 * resident Safe, so the USDC returns to the same account. Both are built for the
 * Safe (ERC-4337 Safe transaction), so the caller signs once with the passkey
 * and executes through the **same** build → passkey → submit seam as the
 * deposit; this module never signs or sends.
 *
 * The amount is supplied by the caller as a whole-USDC decimal string (partial)
 * or as the literal `all`. The `all` case needs the Safe's current share balance
 * (read by the pre-flight gate before anything is built) so `redeem` can name
 * exactly the shares it burns.
 */

const AMOUNT_PATTERN = /^\d+(\.\d{1,6})?$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** Which amount the resident asked to un-allocate. */
export type WithdrawAmount =
  | { readonly kind: 'partial'; readonly amountUsdc: string }
  | { readonly kind: 'all' };

/** Raised when a partial un-allocate amount is not a positive USDC decimal. */
export class InvalidWithdrawAmountError extends Error {
  constructor(value: string) {
    super(
      `The un-allocate amount must be a positive USDC decimal with at most ` +
        `${USDC_DECIMALS} places, got "${value}".`,
    );
    this.name = 'InvalidWithdrawAmountError';
  }
}

/** Raised when "all" is requested without a usable share balance to redeem. */
export class MissingShareBalanceError extends Error {
  constructor() {
    super(
      'An un-allocate of the full balance needs the Safe\u2019s current ' +
        'MetaMorpho share balance, and no positive balance was supplied.',
    );
    this.name = 'MissingShareBalanceError';
  }
}

/** Raised when a caller names a chain other than the configured vault's. */
export class WrongWithdrawChainError extends Error {
  constructor(expected: number, actual: number) {
    super(
      `The MetaMorpho vault is configured on chain ${expected}, but the call ` +
        `was built for chain ${actual}. An un-allocate on another chain would ` +
        'target a vault that does not exist there.',
    );
    this.name = 'WrongWithdrawChainError';
  }
}

function assertSafeAddress(value: string): Address {
  if (!ADDRESS_PATTERN.test(value)) {
    throw new InvalidSafeAddressError(value);
  }
  return value as Address;
}

function parseAmount(amountUsdc: string): bigint {
  if (!AMOUNT_PATTERN.test(amountUsdc.trim())) {
    throw new InvalidWithdrawAmountError(amountUsdc);
  }
  const units = parseUnits(amountUsdc.trim(), USDC_DECIMALS);
  if (units <= 0n) {
    throw new InvalidWithdrawAmountError(amountUsdc);
  }
  return units;
}

/**
 * Resolve the USDC amount in smallest units for a withdrawal request, or `null`
 * when the request is "all".
 *
 * A partial amount is parsed with USDC's six decimals and refused when it is not
 * a positive decimal. "all" carries no asset figure: the redeemed amount is
 * whatever the Safe's whole share balance is worth, so it is `null` here. The
 * pre-flight gate needs this figure to decide sufficiency **before** a plan is
 * built, which is why it is exposed separately from the builder.
 */
export function withdrawAmountUnits(amount: WithdrawAmount): bigint | null {
  return amount.kind === 'all' ? null : parseAmount(amount.amountUsdc);
}

export interface BuildMorphoVaultWithdrawInput {
  /** The configured vault: the vault address, its USDC and the chain id. */
  readonly config: MorphoVaultConfig;
  /** The resident Safe that holds the vault shares and receives the USDC. */
  readonly safeAddress: Address;
  /** The requested amount: a stated USDC figure, or the full share balance. */
  readonly amount: WithdrawAmount;
  /**
   * The Safe's current vault share balance, required for the `all` case so
   * `redeem` burns exactly the shares held. Ignored for a partial withdrawal,
   * which is assets-denominated.
   */
  readonly shareBalance?: bigint;
  /**
   * The chain the transaction will execute on. When supplied it must equal the
   * configured vault's chain; this is the guard that keeps a vault from being
   * called on the wrong network.
   */
  readonly chainId?: number;
}

/**
 * The built, unsigned un-allocate: the single call and the resolved figures.
 *
 * `calls` is exactly what a Safe `MultiSend`/UserOp would execute; for a
 * redemption that is one call. Nothing here is signed or sent.
 */
export interface MorphoVaultWithdrawPlan {
  readonly chainId: number;
  /** The MetaMorpho vault whose shares are redeemed. */
  readonly vault: Address;
  /**
   * The vault's underlying USDC — the token received. Carried so any position
   * read names the same token the call returns, never a second copy.
   */
  readonly usdc: Address;
  readonly safeAddress: Address;
  /** Which amount was requested, so the caller can render it honestly. */
  readonly mode: 'partial' | 'all';
  /** Whole USDC as supplied for a partial; `null` for "all". */
  readonly amountUsdc: string | null;
  /** The USDC amount in smallest unit for a partial; `null` for "all". */
  readonly amountUnits: bigint | null;
  /** The shares `redeem` burns for "all"; `null` for a partial. */
  readonly shareUnits: bigint | null;
  /** The single call: `withdraw` or `redeem`, both to the vault. */
  readonly call: MorphoVaultCall;
  readonly calls: readonly [MorphoVaultCall];
}

/**
 * Build the Call for a MetaMorpho USDC un-allocate, without signing or sending.
 *
 * Pure and deterministic: given the same configuration and amount it returns
 * the same calldata, which is what makes it testable against the vault ABI with
 * no network. The Safe is always both `owner` (whose shares are burned) and
 * `receiver` (who receives the USDC).
 */
export function buildMorphoVaultWithdrawCall(
  input: BuildMorphoVaultWithdrawInput,
): MorphoVaultWithdrawPlan {
  const { config } = input;
  if (input.chainId !== undefined && input.chainId !== config.chainId) {
    throw new WrongWithdrawChainError(config.chainId, input.chainId);
  }

  const safeAddress = assertSafeAddress(input.safeAddress);

  if (input.amount.kind === 'all') {
    const shareUnits = input.shareBalance ?? 0n;
    if (shareUnits <= 0n) {
      // Never fabricate a zero-share redemption: "all" of nothing is a refusal
      // the pre-flight should have caught, and a `redeem(0)` call is a no-op
      // that must not be presented as an un-allocate.
      throw new MissingShareBalanceError();
    }

    const redeemData = encodeFunctionData({
      abi: METAMORPHO_VAULT_ABI,
      functionName: 'redeem',
      args: [shareUnits, safeAddress, safeAddress],
    });
    const call: MorphoVaultCall = { to: config.vault, value: 0n, data: redeemData };

    return {
      chainId: config.chainId,
      vault: config.vault,
      usdc: config.usdc,
      safeAddress,
      mode: 'all',
      amountUsdc: null,
      amountUnits: null,
      shareUnits,
      call,
      calls: [call],
    };
  }

  const amountUnits = parseAmount(input.amount.amountUsdc);
  const withdrawData = encodeFunctionData({
    abi: METAMORPHO_VAULT_ABI,
    functionName: 'withdraw',
    args: [amountUnits, safeAddress, safeAddress],
  });
  const call: MorphoVaultCall = { to: config.vault, value: 0n, data: withdrawData };

  return {
    chainId: config.chainId,
    vault: config.vault,
    usdc: config.usdc,
    safeAddress,
    mode: 'partial',
    amountUsdc: input.amount.amountUsdc.trim(),
    amountUnits,
    shareUnits: null,
    call,
    calls: [call],
  };
}
