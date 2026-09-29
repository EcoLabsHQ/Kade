import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';

/**
 * The EOA → Safe ERC-20 transfer builder (the "Move to vault" step in
 * Holdings).
 *
 * This is deliberately **not** the passkey engine. Here the resident's own
 * connected wallet (`0x…`) is the `from`, signs, and pays the gas: the wallet
 * sends `transfer(safe, amount)` on the token contract, moving USDC to the
 * resident's Safe (or vault). There is no paymaster, no passkey and no user
 * operation — just a correctly built call for the connected wallet to sign.
 *
 * It **builds and never sends**: there is no `writeContract` and no broadcast.
 * The caller hands `data`/`to`/`value` to the connected wallet. The chain id is
 * carried for the wallet to switch networks; no chain-specific address is
 * invented here.
 *
 * Kept beside the Safe engine (`apps/web/src/lib/safe/`) so both movement paths
 * — the wallet-signed transfer and the passkey-signed Safe transaction — live in
 * one module tree and cannot drift.
 *
 * A holding can be an **ERC-20** (USDC) or the chain's **native coin** (ETH).
 * `buildEoaToSafeTransfer` builds the ERC-20 `transfer(safe, amount)`; the
 * native coin has no contract and no calldata, so
 * `buildEoaToSafeNativeTransfer` builds the `{ to, value }` send instead. Both
 * apply the same amount and address validation, and neither signs nor sends.
 */

/** Raised when a transfer amount is not a positive decimal. */
export class InvalidTransferAmountError extends Error {
  constructor(value: string, decimals: number) {
    super(
      `The transfer amount must be a positive decimal with at most ${decimals} ` +
        `places, got "${value}".`,
    );
    this.name = 'InvalidTransferAmountError';
  }
}

/** Raised when the token or Safe address is not a 20-byte hex address. */
export class InvalidTransferAddressError extends Error {
  constructor(field: string, value: string) {
    super(`The ${field} must be a 20-byte hex address, got "${value}".`);
    this.name = 'InvalidTransferAddressError';
  }
}

/**
 * Raised when the connected wallet is not the wallet a holding row belongs to.
 *
 * The row's token sits in a specific wallet; only that wallet may sign the
 * transfer, so a mismatch is refused rather than sent from the wrong account.
 */
export class WrongWalletError extends Error {
  constructor(expected: string, connected: string | null) {
    super(
      connected
        ? `The connected wallet ${connected} is not the wallet this holding belongs to (${expected}). Connect that wallet instead.`
        : `This holding belongs to ${expected}, and no wallet is connected. Connect that wallet first.`,
    );
    this.name = 'WrongWalletError';
  }
}

/**
 * Refuse a connected wallet that is not the row's wallet.
 *
 * The address that signs must be the address the row belongs to; a checksum
 * difference is not a mismatch, so the comparison is case-insensitive.
 *
 * @throws {WrongWalletError} when `connected` is absent or a different address.
 */
export function assertCorrectWallet(
  expected: string,
  connected: string | null | undefined,
): void {
  if (
    !connected ||
    expected.trim().toLowerCase() !== connected.trim().toLowerCase()
  ) {
    throw new WrongWalletError(expected, connected ?? null);
  }
}

/**
 * The honest validation message for an amount, or null when it is usable.
 *
 * Mirrors the builder's own rule (a positive decimal with at most `decimals`
 * places) so the dialog can say what is wrong before anything is sent.
 */
export function validateTransferAmount(
  amount: string,
  decimals = 6,
): string | null {
  try {
    parseAmount(amount, decimals);
    return null;
  } catch {
    return `Enter a positive amount with at most ${decimals} decimal places.`;
  }
}

const AMOUNT_PATTERN = /^(\d+)(?:\.(\d+))?$/;

export interface BuildEoaToSafeTransferInput {
  /** The chain the wallet must be on. Carried; never used to pick an address. */
  readonly chainId: number;
  /** The ERC-20 token to move (e.g. USDC). */
  readonly token: Address;
  /** The resident's Safe (or vault): the recipient. */
  readonly safeAddress: Address;
  /** The amount as a whole-token decimal string (e.g. "25000" or "1500.5"). */
  readonly amount: string;
  /** The token's decimals. Defaults to USDC's 6. */
  readonly decimals?: number;
}

/**
 * The built, unsigned call for the connected wallet. `value` is `0n`: this is an
 * ERC-20 transfer, not a native-value send. Nothing here is signed or sent.
 */
export interface EoaToSafeTransferPlan {
  readonly chainId: number;
  readonly token: Address;
  readonly to: Address;
  readonly amount: string;
  readonly amountUnits: bigint;
  readonly data: Hex;
  readonly value: 0n;
}

export interface BuildEoaToSafeNativeTransferInput {
  /** The chain the wallet must be on. Carried; never used to pick an address. */
  readonly chainId: number;
  /** The resident's Safe (or vault): the recipient. */
  readonly safeAddress: Address;
  /** The amount as a whole-coin decimal string (e.g. "1" or "0.25"). */
  readonly amount: string;
}

/**
 * The built native-coin send for the connected wallet.
 *
 * There is no token contract and no calldata: the whole transaction is the
 * recipient plus the `value` moved, exactly what wagmi's `sendTransaction`
 * (`to`, `value`) wants. `value` equals `amountUnits`; nothing here is signed or
 * sent.
 */
export interface EoaToSafeNativeTransferPlan {
  readonly chainId: number;
  readonly to: Address;
  readonly amount: string;
  readonly amountUnits: bigint;
  readonly value: bigint;
}

/** The native coin is 18 decimals on every chain this app reads. */
export const NATIVE_DECIMALS = 18;

function assertAddress(field: string, value: string): Address {
  if (!isAddress(value, { strict: false })) {
    throw new InvalidTransferAddressError(field, value);
  }
  return getAddress(value);
}

function parseAmount(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  const match = AMOUNT_PATTERN.exec(trimmed);
  if (!match || (match[2]?.length ?? 0) > decimals) {
    throw new InvalidTransferAmountError(amount, decimals);
  }
  const units = parseUnits(trimmed, decimals);
  if (units <= 0n) {
    throw new InvalidTransferAmountError(amount, decimals);
  }
  return units;
}

/**
 * Build `token.transfer(safeAddress, amountUnits)`, without signing or sending.
 *
 * Pure and deterministic: the same input yields the same calldata, so the call
 * is testable against the ERC-20 ABI with no network.
 */
export function buildEoaToSafeTransfer(
  input: BuildEoaToSafeTransferInput,
): EoaToSafeTransferPlan {
  const decimals = input.decimals ?? 6;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new InvalidTransferAmountError(input.amount, decimals);
  }

  const token = assertAddress('token', input.token);
  const safeAddress = assertAddress('safeAddress', input.safeAddress);
  const amountUnits = parseAmount(input.amount, decimals);

  return {
    chainId: input.chainId,
    token,
    to: safeAddress,
    amount: input.amount.trim(),
    amountUnits,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [safeAddress, amountUnits],
    }),
    value: 0n,
  };
}

/**
 * Build the native-coin send to `safeAddress`, without signing or sending.
 *
 * Pure and deterministic: the same input yields the same `{ to, value }`. The
 * amount is validated exactly like the ERC-20 builder (a positive decimal with
 * at most 18 places); the recipient uses the same 20-byte address guard.
 */
export function buildEoaToSafeNativeTransfer(
  input: BuildEoaToSafeNativeTransferInput,
): EoaToSafeNativeTransferPlan {
  const safeAddress = assertAddress('safeAddress', input.safeAddress);
  const amountUnits = parseAmount(input.amount, NATIVE_DECIMALS);

  return {
    chainId: input.chainId,
    to: safeAddress,
    amount: input.amount.trim(),
    amountUnits,
    value: amountUnits,
  };
}
