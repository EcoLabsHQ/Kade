import { describe, expect, it } from 'vitest';
import { decodeFunctionData, encodeFunctionData, getAddress, type Address } from 'viem';
import { METAMORPHO_VAULT_ABI } from '@/lib/invest/morpho-abi';
import {
  InvalidWithdrawAmountError,
  MissingShareBalanceError,
  WrongWithdrawChainError,
  buildMorphoVaultWithdrawCall,
  withdrawAmountUnits,
} from '@/lib/invest/morpho-withdraw';
import { InvalidSafeAddressError } from '@/lib/invest/morpho-deposit';
import type { MorphoVaultConfig } from '@/lib/invest/morpho-config';

/**
 * The MetaMorpho vault **un-allocate** calldata (the inverse of a deposit).
 *
 * These tests are deterministic and offline: no RPC, no signing, no write. They
 * decode the built calldata back through the **vault ABI** and assert the exact
 * values, so a change to the function selector, the argument order or the
 * `owner`/`receiver` identity fails here rather than on mainnet.
 *
 * The operation is a single ERC-4626 redemption with the Safe as `owner` (whose
 * shares are burned) and `receiver` (who receives the USDC): `withdraw(assets,
 * receiver, owner)` for a stated amount, `redeem(shares, receiver, owner)` for
 * the full share balance. No `approve` is involved.
 */

const VAULT = getAddress('0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB');
const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const SAFE = getAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
const OTHER_HOLDER = getAddress('0x2222333344445555666677778888999900001111');
const BASE_VAULT = getAddress('0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61');
const BASE_USDC = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');

function config(
  overrides: Partial<MorphoVaultConfig> = {},
): MorphoVaultConfig {
  return { vault: VAULT, usdc: USDC, chainId: 1, ...overrides };
}

function decode(data: `0x${string}`) {
  return decodeFunctionData({ abi: METAMORPHO_VAULT_ABI, data });
}

describe('buildMorphoVaultWithdrawCall — partial amount', () => {
  it('builds a single withdraw(assets, receiver, owner) with the Safe as both owner and receiver', () => {
    const plan = buildMorphoVaultWithdrawCall({
      config: config(),
      safeAddress: SAFE,
      amount: { kind: 'partial', amountUsdc: '1500.5' },
    });

    // One call only: redemption needs no approve.
    expect(plan.calls).toHaveLength(1);
    expect(plan.calls[0]).toBe(plan.call);
    expect(plan.call.to).toBe(VAULT);
    expect(plan.call.value).toBe(0n);

    const decoded = decode(plan.call.data);
    expect(decoded.functionName).toBe('withdraw');
    const [assets, receiver, owner] = decoded.args as unknown as [bigint, Address, Address];

    expect(assets).toBe(1_500_500_000n); // 1500.5 USDC at 6 decimals
    // The USDC returns to the resident's own Safe, and the shares burned are
    // the Safe's own — never a third party's.
    expect(getAddress(receiver)).toBe(SAFE);
    expect(getAddress(owner)).toBe(SAFE);
    expect(getAddress(owner)).not.toBe(OTHER_HOLDER);

    expect(plan.mode).toBe('partial');
    expect(plan.amountUsdc).toBe('1500.5');
    expect(plan.amountUnits).toBe(1_500_500_000n);
    expect(plan.shareUnits).toBeNull();
  });

  it('accepts the maximum USDC precision (6 places)', () => {
    const plan = buildMorphoVaultWithdrawCall({
      config: config(),
      safeAddress: SAFE,
      amount: { kind: 'partial', amountUsdc: '0.000001' },
    });
    expect(plan.amountUnits).toBe(1n);
  });

  it('rejects zero, negative, malformed and over-precise amounts', () => {
    for (const bad of ['0', '0.0', '-5', '1e6', 'abc', '1.1234567', '']) {
      expect(() =>
        buildMorphoVaultWithdrawCall({
          config: config(),
          safeAddress: SAFE,
          amount: { kind: 'partial', amountUsdc: bad },
        }),
      ).toThrow(InvalidWithdrawAmountError);
    }
  });
});

describe('buildMorphoVaultWithdrawCall — all', () => {
  it('builds redeem(shares, receiver, owner) burning exactly the held shares, with the Safe as owner and receiver', () => {
    const shares = 123_456_789_000_000_000_000n;
    const plan = buildMorphoVaultWithdrawCall({
      config: config(),
      safeAddress: SAFE,
      amount: { kind: 'all' },
      shareBalance: shares,
    });

    expect(plan.calls).toHaveLength(1);
    expect(plan.call.to).toBe(VAULT);
    const decoded = decode(plan.call.data);
    expect(decoded.functionName).toBe('redeem');
    const [redeemed, receiver, owner] = decoded.args as unknown as [bigint, Address, Address];

    // Exactly the whole balance is burned: nothing is left behind.
    expect(redeemed).toBe(shares);
    expect(getAddress(receiver)).toBe(SAFE);
    expect(getAddress(owner)).toBe(SAFE);

    expect(plan.mode).toBe('all');
    expect(plan.amountUsdc).toBeNull();
    expect(plan.amountUnits).toBeNull();
    expect(plan.shareUnits).toBe(shares);
  });

  it('refuses "all" without a positive share balance rather than fabricating redeem(0)', () => {
    expect(() =>
      buildMorphoVaultWithdrawCall({
        config: config(),
        safeAddress: SAFE,
        amount: { kind: 'all' },
      }),
    ).toThrow(MissingShareBalanceError);

    expect(() =>
      buildMorphoVaultWithdrawCall({
        config: config(),
        safeAddress: SAFE,
        amount: { kind: 'all' },
        shareBalance: 0n,
      }),
    ).toThrow(MissingShareBalanceError);
  });
});

describe('buildMorphoVaultWithdrawCall — chain, safety and determinism', () => {
  it('targets the selected chain’s own vault, not an address literal', () => {
    const plan = buildMorphoVaultWithdrawCall({
      config: config({ vault: BASE_VAULT, usdc: BASE_USDC, chainId: 8453 }),
      safeAddress: SAFE,
      amount: { kind: 'partial', amountUsdc: '100' },
    });
    expect(plan.chainId).toBe(8453);
    expect(plan.vault).toBe(BASE_VAULT);
    expect(plan.usdc).toBe(BASE_USDC);
    expect(plan.call.to).toBe(BASE_VAULT);
  });

  it('refuses an un-allocate built for a chain other than the vault chain', () => {
    expect(() =>
      buildMorphoVaultWithdrawCall({
        config: config(),
        safeAddress: SAFE,
        amount: { kind: 'partial', amountUsdc: '10' },
        chainId: 11155111,
      }),
    ).toThrow(WrongWithdrawChainError);
  });

  it('rejects a malformed Safe address used as owner/receiver', () => {
    expect(() =>
      buildMorphoVaultWithdrawCall({
        config: config(),
        safeAddress: '0x1234',
        amount: { kind: 'partial', amountUsdc: '10' },
      }),
    ).toThrow(InvalidSafeAddressError);
  });

  it('is deterministic: the same inputs build identical calldata', () => {
    const a = buildMorphoVaultWithdrawCall({
      config: config(),
      safeAddress: SAFE,
      amount: { kind: 'partial', amountUsdc: '42' },
    });
    const b = buildMorphoVaultWithdrawCall({
      config: config(),
      safeAddress: SAFE,
      amount: { kind: 'partial', amountUsdc: '42' },
    });
    expect(a.call.data).toBe(b.call.data);
  });

  it('resolves the pre-flight amount units (null for "all")', () => {
    expect(withdrawAmountUnits({ kind: 'partial', amountUsdc: '2.5' })).toBe(
      2_500_000n,
    );
    expect(withdrawAmountUnits({ kind: 'all' })).toBeNull();
    expect(() => withdrawAmountUnits({ kind: 'partial', amountUsdc: 'x' })).toThrow(
      InvalidWithdrawAmountError,
    );
  });
});

describe('METAMORPHO_VAULT_ABI redemption surface', () => {
  it('declares withdraw and redeem with (amount, receiver, owner)', () => {
    for (const name of ['withdraw', 'redeem'] as const) {
      const data = encodeFunctionData({
        abi: METAMORPHO_VAULT_ABI,
        functionName: name,
        args: [1_000_000n, SAFE, SAFE],
      });
      const decoded = decode(data);
      expect(decoded.functionName).toBe(name);
      expect(decoded.args).toEqual([1_000_000n, SAFE, SAFE]);
    }
  });
});
