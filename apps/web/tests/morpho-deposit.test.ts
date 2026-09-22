import { describe, expect, it } from 'vitest';
import {
  decodeFunctionData,
  erc20Abi,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import {
  MORPHO_BLUE_ABI,
  marketId,
  type MarketParams,
} from '@/lib/invest/morpho-abi';
import {
  USDC_DECIMALS,
  buildMorphoDepositCall,
  InvalidDepositAmountError,
  WrongDepositChainError,
  InvalidSafeAddressError,
} from '@/lib/invest/morpho-deposit';
import {
  MORPHO_ENV_KEYS,
  isMorphoConfigured,
  morphoChainId,
  readMorphoPoolConfig,
} from '@/lib/invest/morpho-config';

/**
 * The Morpho deposit calldata (D18 / EXE-014).
 *
 * These tests are deterministic and offline: no RPC, no signing, no write. They
 * decode the built calldata back through the **Morpho ABI** and assert the exact
 * values, so a change to the tuple order, the function selector or the argument
 * order fails here rather than on mainnet.
 *
 * The market id vector is a real one: the Ethereum-mainnet USDC/WETH 86% market
 * (`app.morpho.org/ethereum/.../0x94b823e6...`). `marketId` must reproduce it
 * from the five parameters, which pins the `keccak256(abi.encode(...))` encoding.
 */

const MORPHO = getAddress('0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb');
const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const WETH = getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
const ORACLE = getAddress('0x0F948CBa8231Db7898ef36A4212581Ad7b1B4580');
const IRM = getAddress('0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC');
const LLTV = 860_000_000_000_000_000n; // 86%
const SAFE = getAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');

/**
 * The canonical mainnet USDC/WETH 86% market id, as published by Morpho. The
 * encoder must derive exactly this from the five parameters below.
 */
const REAL_MARKET_ID =
  '0x94b823e6bd8ea533b4e33fbc307faea0b307301bc48763acc4d4aa4def7636cd' as Hex;

const MARKET: MarketParams = {
  loanToken: USDC,
  collateralToken: WETH,
  oracle: ORACLE,
  irm: IRM,
  lltv: LLTV,
};

function config(overrides: Partial<MarketParams> = {}) {
  const marketParams = { ...MARKET, ...overrides };
  return {
    morpho: MORPHO,
    chainId: 1,
    marketParams,
    marketId: marketId(marketParams),
  };
}

describe('marketId', () => {
  it('reproduces the canonical mainnet USDC/WETH 86% market id', () => {
    // If this fails the tuple encoding or the field order is wrong, and every
    // deposit would target a different market than the one configured.
    expect(marketId(MARKET)).toBe(REAL_MARKET_ID);
  });

  it('changes when any single market parameter changes', () => {
    const base = marketId(MARKET);
    expect(marketId({ ...MARKET, lltv: 91_500_000_000_000_000n })).not.toBe(base);
    expect(marketId({ ...MARKET, oracle: getAddress('0x' + '11'.repeat(20)) })).not.toBe(base);
    expect(marketId({ ...MARKET, loanToken: WETH })).not.toBe(base);
  });
});

describe('buildMorphoDepositCall', () => {
  it('approves the Morpho contract for exactly the deposit, from the USDC token', () => {
    const plan = buildMorphoDepositCall({
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
    // Spender is Morpho, not the pool's token or the Safe.
    expect(getAddress(spender)).toBe(MORPHO);
    expect(amount).toBe(25_000n * 10n ** BigInt(USDC_DECIMALS));
  });

  it('supplies exactly the deposit, in assets, on behalf of the Safe', () => {
    const plan = buildMorphoDepositCall({
      config: config(),
      safeAddress: SAFE,
      amountUsdc: '1500.5',
    });

    expect(plan.supply.to).toBe(MORPHO);
    expect(plan.supply.value).toBe(0n);

    // Decode strictly through the Morpho ABI: this is the assertion that the
    // calldata is the ABI the contract expects, not merely well-formed hex.
    const decoded = decodeFunctionData({
      abi: MORPHO_BLUE_ABI,
      data: plan.supply.data,
    });
    expect(decoded.functionName).toBe('supply');

    // viem decodes a tuple with named components to an object, so the fields
    // are asserted by name — the order is already pinned by `marketId`.
    const args = decoded.args as unknown as [
      {
        readonly loanToken: Address;
        readonly collateralToken: Address;
        readonly oracle: Address;
        readonly irm: Address;
        readonly lltv: bigint;
      },
      bigint,
      bigint,
      Address,
      Hex,
    ];
    const [params, assets, shares, onBehalf, data] = args;

    expect(getAddress(params.loanToken)).toBe(USDC);
    expect(getAddress(params.collateralToken)).toBe(WETH);
    expect(getAddress(params.oracle)).toBe(ORACLE);
    expect(getAddress(params.irm)).toBe(IRM);
    expect(params.lltv).toBe(LLTV);

    // Assets-denominated: exactly the amount, shares = 0 (no slippage).
    expect(assets).toBe(1_500_500_000n); // 1500.5 USDC at 6 decimals
    expect(shares).toBe(0n);
    // The position is the resident Safe's.
    expect(getAddress(onBehalf)).toBe(SAFE);
    expect(data).toBe('0x');
  });

  it('orders the calls approve-then-supply, both from the Safe account', () => {
    const plan = buildMorphoDepositCall({
      config: config(),
      safeAddress: SAFE,
      amountUsdc: '100',
    });
    expect(plan.calls).toHaveLength(2);
    expect(plan.calls[0]).toBe(plan.approve);
    expect(plan.calls[1]).toBe(plan.supply);
    // The approve must name Morpho as spender, or supply cannot pull the USDC.
    const approve = decodeFunctionData({ abi: erc20Abi, data: plan.approve.data });
    const [spender] = approve.args as unknown as [Address, bigint];
    expect(getAddress(spender)).toBe(plan.supply.to);
  });

  it('is deterministic: the same inputs build identical calldata', () => {
    const a = buildMorphoDepositCall({ config: config(), safeAddress: SAFE, amountUsdc: '42' });
    const b = buildMorphoDepositCall({ config: config(), safeAddress: SAFE, amountUsdc: '42' });
    expect(a.approve.data).toBe(b.approve.data);
    expect(a.supply.data).toBe(b.supply.data);
  });

  it('carries the configured chain id and market id through the plan', () => {
    const cfg = config();
    const plan = buildMorphoDepositCall({ config: cfg, safeAddress: SAFE, amountUsdc: '1' });
    expect(plan.chainId).toBe(1);
    expect(plan.marketId).toBe(cfg.marketId);
    expect(plan.morpho).toBe(MORPHO);
  });

  it('refuses a deposit built for a chain other than the pool chain', () => {
    expect(() =>
      buildMorphoDepositCall({
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
        buildMorphoDepositCall({ config: config(), safeAddress: SAFE, amountUsdc: bad }),
      ).toThrow(InvalidDepositAmountError);
    }
  });

  it('accepts the maximum USDC precision (6 places)', () => {
    const plan = buildMorphoDepositCall({
      config: config(),
      safeAddress: SAFE,
      amountUsdc: '0.000001',
    });
    expect(plan.amountUnits).toBe(1n);
  });

  it('rejects a malformed Safe address', () => {
    expect(() =>
      buildMorphoDepositCall({ config: config(), safeAddress: '0x1234', amountUsdc: '10' }),
    ).toThrow(InvalidSafeAddressError);
  });
});

describe('readMorphoPoolConfig', () => {
  const ENV = {
    [MORPHO_ENV_KEYS.morpho]: MORPHO,
    [MORPHO_ENV_KEYS.loanToken]: USDC,
    [MORPHO_ENV_KEYS.collateralToken]: WETH,
    [MORPHO_ENV_KEYS.oracle]: ORACLE,
    [MORPHO_ENV_KEYS.irm]: IRM,
    [MORPHO_ENV_KEYS.lltv]: LLTV.toString(),
  } as const;

  it('is not configured when any required key is absent', () => {
    expect(isMorphoConfigured({})).toBe(false);
    // The pool id is optional, so it is not in the required set.
    const required = Object.values(MORPHO_ENV_KEYS).filter(
      (key) => key !== MORPHO_ENV_KEYS.poolId,
    );
    for (const key of required) {
      const partial: Record<string, string | undefined> = { ...ENV };
      delete partial[key];
      expect(isMorphoConfigured(partial)).toBe(false);
    }
  });

  it('is still configured when the optional pool id is absent', () => {
    expect(isMorphoConfigured(ENV)).toBe(true);
  });

  it('resolves a complete, well-formed configuration on the mainnet chain id', () => {
    const cfg = readMorphoPoolConfig(ENV);
    expect(cfg).not.toBeNull();
    expect(cfg?.chainId).toBe(morphoChainId());
    expect(cfg?.chainId).toBe(1);
    expect(cfg?.morpho).toBe(MORPHO);
    expect(cfg?.marketId).toBe(REAL_MARKET_ID);
  });

  it('rejects a malformed address rather than using it', () => {
    expect(readMorphoPoolConfig({ ...ENV, [MORPHO_ENV_KEYS.oracle]: '0xnope' })).toBeNull();
  });

  it('rejects a non-decimal lltv', () => {
    expect(readMorphoPoolConfig({ ...ENV, [MORPHO_ENV_KEYS.lltv]: '86%' })).toBeNull();
  });

  it('accepts a matching expected pool id and rejects a mismatched one', () => {
    expect(
      readMorphoPoolConfig({ ...ENV, [MORPHO_ENV_KEYS.poolId]: REAL_MARKET_ID }),
    ).not.toBeNull();
    expect(
      readMorphoPoolConfig({ ...ENV, [MORPHO_ENV_KEYS.poolId]: `0x${'ab'.repeat(32)}` }),
    ).toBeNull();
  });
});
