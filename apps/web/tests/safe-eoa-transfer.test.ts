import { describe, expect, it } from 'vitest';
import { decodeFunctionData, erc20Abi, getAddress, type Address } from 'viem';
import {
  buildEoaToSafeTransfer,
  InvalidTransferAddressError,
  InvalidTransferAmountError,
} from '@/lib/safe/eoa-transfer';

/**
 * The EOA → Safe ERC-20 transfer builder (the "Move to vault" step).
 *
 * The connected wallet signs and pays for this call; these tests decode the
 * built calldata back through the ERC-20 ABI and assert the recipient and the
 * amount, with no network, no signing and no send.
 */

const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const SAFE = getAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');

describe('buildEoaToSafeTransfer', () => {
  it('builds transfer(safe, amount) with USDC decimals and no native value', () => {
    const plan = buildEoaToSafeTransfer({
      chainId: 11155111,
      token: USDC,
      safeAddress: SAFE,
      amount: '1500.5',
    });

    expect(plan.token).toBe(USDC);
    expect(plan.to).toBe(SAFE);
    expect(plan.amountUnits).toBe(1_500_500_000n);
    expect(plan.value).toBe(0n);
    expect(plan.chainId).toBe(11155111);

    const decoded = decodeFunctionData({ abi: erc20Abi, data: plan.data });
    expect(decoded.functionName).toBe('transfer');
    expect(getAddress(decoded.args[0] as string)).toBe(SAFE);
    expect(decoded.args[1]).toBe(1_500_500_000n);
  });

  it('honours a non-USDC token decimals', () => {
    const plan = buildEoaToSafeTransfer({
      chainId: 1,
      token: USDC,
      safeAddress: SAFE,
      amount: '1.5',
      decimals: 18,
    });
    expect(plan.amountUnits).toBe(1_500_000_000_000_000_000n);
  });

  it('refuses a non-positive or malformed amount', () => {
    const base = { chainId: 1, token: USDC, safeAddress: SAFE } as const;
    expect(() => buildEoaToSafeTransfer({ ...base, amount: '0' })).toThrow(
      InvalidTransferAmountError,
    );
    expect(() => buildEoaToSafeTransfer({ ...base, amount: '-1' })).toThrow(
      InvalidTransferAmountError,
    );
    expect(() => buildEoaToSafeTransfer({ ...base, amount: '1.2345678' })).toThrow(
      InvalidTransferAmountError,
    );
  });

  it('refuses a malformed token or recipient address', () => {
    expect(() =>
      buildEoaToSafeTransfer({
        chainId: 1,
        token: 'not-an-address' as unknown as Address,
        safeAddress: SAFE,
        amount: '1',
      }),
    ).toThrow(InvalidTransferAddressError);
    expect(() =>
      buildEoaToSafeTransfer({
        chainId: 1,
        token: USDC,
        safeAddress: '0x1234' as unknown as Address,
        amount: '1',
      }),
    ).toThrow(InvalidTransferAddressError);
  });
});
