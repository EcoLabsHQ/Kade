import { describe, expect, it } from 'vitest';
import {
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Address,
} from 'viem';
import { METAMORPHO_VAULT_ABI } from '@/lib/invest/morpho-abi';
import {
  USDC_DECIMALS,
  buildMorphoVaultDepositCall,
  InvalidDepositAmountError,
  WrongDepositChainError,
  InvalidSafeAddressError,
} from '@/lib/invest/morpho-deposit';
import {
  MORPHO_VAULT_ENV_KEYS,
  isMorphoVaultConfigured,
  morphoChainId,
  readMorphoVaultConfig,
} from '@/lib/invest/morpho-config';

/**
 * The MetaMorpho vault deposit calldata (D18 / EXE-014).
 *
 * These tests are deterministic and offline: no RPC, no signing, no write. They
 * decode the built calldata back through the **vault ABI** and assert the exact
 * values, so a change to the function selector or the argument order fails here
 * rather than on mainnet.
 *
 * The Invest target is a MetaMorpho vault, not a Morpho Blue market: the call is
 * ERC-4626 `deposit(assets, receiver)`, the position is an ERC-20 share balance,
 * and there is no market id to pin. The vault and its USDC are configuration.
 */

const VAULT = getAddress('0x1111222233334444555566667777888899990000');
const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const SAFE = getAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
const OTHER_HOLDER = getAddress('0x2222333344445555666677778888999900001111');

function config(overrides: Partial<{ vault: Address; usdc: Address; chainId: number }> = {}) {
  return {
    vault: VAULT,
    usdc: USDC,
    chainId: 1,
    ...overrides,
  };
}

describe('METAMORPHO_VAULT_ABI', () => {
  it('reads the vault position as ERC-20 shares, not a market position', () => {
    const balanceOf = encodeFunctionData({
      abi: METAMORPHO_VAULT_ABI,
      functionName: 'balanceOf',
      args: [SAFE],
    });
    expect(decodeFunctionData({ abi: METAMORPHO_VAULT_ABI, data: balanceOf })).toEqual({
      functionName: 'balanceOf',
      args: [SAFE],
    });

    const convertToAssets = encodeFunctionData({
      abi: METAMORPHO_VAULT_ABI,
      functionName: 'convertToAssets',
      args: [1_000_000n],
    });
    expect(
      decodeFunctionData({ abi: METAMORPHO_VAULT_ABI, data: convertToAssets }).functionName,
    ).toBe('convertToAssets');

    const asset = encodeFunctionData({ abi: METAMORPHO_VAULT_ABI, functionName: 'asset' });
    expect(
      decodeFunctionData({ abi: METAMORPHO_VAULT_ABI, data: asset }).functionName,
    ).toBe('asset');
  });
});

describe('buildMorphoVaultDepositCall', () => {
  it('approves the vault for exactly the deposit, from the USDC token', () => {
    const plan = buildMorphoVaultDepositCall({
      config: config(),
      safeAddress: SAFE,
      amountUsdc: '25000',
    });

    expect(plan.approve.to).toBe(USDC);
    expect(plan.approve.value).toBe(0n);

    const decoded = decodeFunctionData({
      abi: erc20Abi,
      data: plan.approve.data,
    });
    expect(decoded.functionName).toBe('approve');
    const [spender, amount] = decoded.args as unknown as [Address, bigint];
    // Spender is the vault, not the USDC token or the Safe.
    expect(getAddress(spender)).toBe(VAULT);
    expect(amount).toBe(25_000n * 10n ** BigInt(USDC_DECIMALS));
  });

  it('deposits exactly the amount with the Safe as receiver', () => {
    const plan = buildMorphoVaultDepositCall({
      config: config(),
      safeAddress: SAFE,
      amountUsdc: '1500.5',
    });

    expect(plan.deposit.to).toBe(VAULT);
    expect(plan.deposit.value).toBe(0n);

    // Decode strictly through the vault ABI: this is the assertion that the
    // calldata is the ABI the contract expects, not merely well-formed hex.
    const decoded = decodeFunctionData({
      abi: METAMORPHO_VAULT_ABI,
      data: plan.deposit.data,
    });
    expect(decoded.functionName).toBe('deposit');
    const [assets, receiver] = decoded.args as unknown as [bigint, Address];

    expect(assets).toBe(1_500_500_000n); // 1500.5 USDC at 6 decimals
    // The shares are the resident Safe's, not the vault's or a third party's.
    expect(getAddress(receiver)).toBe(SAFE);
    expect(getAddress(receiver)).not.toBe(VAULT);
  });

  it('orders the calls approve-then-deposit, both from the Safe account', () => {
    const plan = buildMorphoVaultDepositCall({
      config: config(),
      safeAddress: SAFE,
      amountUsdc: '100',
    });
    expect(plan.calls).toHaveLength(2);
    expect(plan.calls[0]).toBe(plan.approve);
    expect(plan.calls[1]).toBe(plan.deposit);
    // The approve must name the vault as spender, or deposit cannot pull the USDC.
    const approve = decodeFunctionData({ abi: erc20Abi, data: plan.approve.data });
    const [spender] = approve.args as unknown as [Address, bigint];
    expect(getAddress(spender)).toBe(plan.deposit.to);
  });

  it('is deterministic: the same inputs build identical calldata', () => {
    const a = buildMorphoVaultDepositCall({ config: config(), safeAddress: SAFE, amountUsdc: '42' });
    const b = buildMorphoVaultDepositCall({ config: config(), safeAddress: SAFE, amountUsdc: '42' });
    expect(a.approve.data).toBe(b.approve.data);
    expect(a.deposit.data).toBe(b.deposit.data);
  });

  it('carries the configured chain id and vault through the plan', () => {
    const cfg = config();
    const plan = buildMorphoVaultDepositCall({ config: cfg, safeAddress: SAFE, amountUsdc: '1' });
    expect(plan.chainId).toBe(1);
    expect(plan.vault).toBe(cfg.vault);
    expect(plan.vault).toBe(VAULT);
  });

  it('refuses a deposit built for a chain other than the vault chain', () => {
    expect(() =>
      buildMorphoVaultDepositCall({
        config: config(),
        safeAddress: SAFE,
        amountUsdc: '10',
        chainId: 11155111,
      }),
    ).toThrow(WrongDepositChainError);
  });

  it('rejects zero, negative, malformed and over-precise amounts', () => {
    for (const bad of ['0', '0.0', '-5', '1e6', 'abc', '1.1234567', '']) {
      expect(() =>
        buildMorphoVaultDepositCall({ config: config(), safeAddress: SAFE, amountUsdc: bad }),
      ).toThrow(InvalidDepositAmountError);
    }
  });

  it('accepts the maximum USDC precision (6 places)', () => {
    const plan = buildMorphoVaultDepositCall({
      config: config(),
      safeAddress: SAFE,
      amountUsdc: '0.000001',
    });
    expect(plan.amountUnits).toBe(1n);
  });

  it('rejects a malformed Safe address used as the receiver', () => {
    expect(() =>
      buildMorphoVaultDepositCall({ config: config(), safeAddress: '0x1234', amountUsdc: '10' }),
    ).toThrow(InvalidSafeAddressError);
  });

  it('never sends the shares to another holder', () => {
    const plan = buildMorphoVaultDepositCall({
      config: config(),
      safeAddress: SAFE,
      amountUsdc: '10',
    });
    const [, receiver] = decodeFunctionData({
      abi: METAMORPHO_VAULT_ABI,
      data: plan.deposit.data,
    }).args as unknown as [bigint, Address];
    expect(getAddress(receiver)).toBe(SAFE);
    expect(getAddress(receiver)).not.toBe(OTHER_HOLDER);
  });
});

describe('readMorphoVaultConfig', () => {
  const ENV = {
    [MORPHO_VAULT_ENV_KEYS.vault]: VAULT,
    [MORPHO_VAULT_ENV_KEYS.usdc]: USDC,
  } as const;

  it('is not configured when any required key is absent', () => {
    expect(isMorphoVaultConfigured({})).toBe(false);
    for (const key of Object.values(MORPHO_VAULT_ENV_KEYS)) {
      const partial: Record<string, string | undefined> = { ...ENV };
      delete partial[key];
      expect(isMorphoVaultConfigured(partial)).toBe(false);
    }
  });

  it('resolves a complete, well-formed vault configuration on the mainnet chain id', () => {
    const cfg = readMorphoVaultConfig(ENV);
    expect(cfg).not.toBeNull();
    expect(cfg?.chainId).toBe(morphoChainId());
    expect(cfg?.chainId).toBe(1);
    expect(cfg?.vault).toBe(VAULT);
    expect(cfg?.usdc).toBe(USDC);
  });

  it('rejects a malformed vault address without throwing', () => {
    const malformed = { ...ENV, [MORPHO_VAULT_ENV_KEYS.vault]: '0x1234' };
    expect(() => readMorphoVaultConfig(malformed)).not.toThrow();
    expect(readMorphoVaultConfig(malformed)).toBeNull();
    expect(isMorphoVaultConfigured(malformed)).toBe(false);
    expect(() => isMorphoVaultConfigured(malformed)).not.toThrow();
  });

  it('rejects a malformed USDC address rather than using it', () => {
    expect(readMorphoVaultConfig({ ...ENV, [MORPHO_VAULT_ENV_KEYS.usdc]: '0xnope' })).toBeNull();
  });
});
