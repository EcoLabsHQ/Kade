import { describe, expect, it, vi } from 'vitest';
import { decodeFunctionData, getAddress, type Address } from 'viem';
import { MORPHO_VAULT_CHAIN_IDS } from '@kade/shared';
import { METAMORPHO_VAULT_ABI } from '@/lib/invest/morpho-abi';
import { prepareMorphoVaultWithdraw } from '@/lib/invest/morpho-execution';
import { readMorphoVaultConfigForChain } from '@/lib/invest/morpho-config';
import type { SafeVaultShareRead } from '@/lib/invest/safe-vault-shares';

/**
 * The config-gated MetaMorpho **un-allocate** build boundary.
 *
 * These tests exercise the real `prepareMorphoVaultWithdraw` against the pinned
 * per-chain registry, with the share read injected, so nothing touches the
 * network. They prove the inverse of the deposit's contract:
 *
 *   1. for each configured chain it builds a single ERC-4626 call against
 *      **that chain's** vault, with the Safe as both `owner` and `receiver`;
 *   2. the share pre-flight refuses **before** a plan exists when the Safe's
 *      shares cannot cover the request, and refuses with the real reason when
 *      the read fails;
 *   3. a chain with no pinned vault is refused with a message naming the chain.
 */

const SAFE = getAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');

function sufficient(shares = 10n, assetsUsdc = 1_000_000_000n) {
  return vi.fn(
    async (): Promise<SafeVaultShareRead> => ({ status: 'read', shares, assetsUsdc }),
  );
}

function decode(data: `0x${string}`) {
  return decodeFunctionData({ abi: METAMORPHO_VAULT_ABI, data });
}

describe('prepareMorphoVaultWithdraw — per-chain redemption through the pinned registry', () => {
  it('builds a partial withdraw against each chain’s own vault with the Safe as owner and receiver', async () => {
    for (const chainId of MORPHO_VAULT_CHAIN_IDS) {
      const expected = readMorphoVaultConfigForChain(chainId, {});
      const reader = sufficient();
      const result = await prepareMorphoVaultWithdraw(
        { safeAddress: SAFE, amount: { kind: 'partial', amountUsdc: '10' }, chainId },
        { env: {}, railConfigured: true, sharesReader: reader },
      );

      expect(result.status, `chain ${chainId}`).toBe('ready-to-execute');
      if (result.status !== 'ready-to-execute') continue;

      expect(result.plan.chainId).toBe(chainId);
      expect(result.plan.vault).toBe(expected?.vault);
      expect(result.plan.calls).toHaveLength(1);
      const decoded = decode(result.plan.call.data);
      expect(decoded.functionName).toBe('withdraw');
      const [assets, receiver, owner] = decoded.args as unknown as [
        bigint,
        Address,
        Address,
      ];
      expect(assets).toBe(10_000_000n);
      expect(getAddress(receiver)).toBe(SAFE);
      expect(getAddress(owner)).toBe(SAFE);

      // The pre-flight read the same chain's vault the call targets.
      expect(reader).toHaveBeenCalledWith({
        safeAddress: SAFE,
        vault: expected?.vault,
        chainId,
        chainName: expect.any(String),
        amountUnits: 10_000_000n,
      });
    }
  });

  it('builds "all" as a redeem of the whole share balance on the selected chain', async () => {
    const vet = readMorphoVaultConfigForChain(8453, {});
    const reader = sufficient(123n, 999n);
    const result = await prepareMorphoVaultWithdraw(
      { safeAddress: SAFE, amount: { kind: 'all' }, chainId: 8453 },
      { env: {}, railConfigured: true, sharesReader: reader },
    );

    expect(result.status).toBe('ready-to-execute');
    if (result.status !== 'ready-to-execute') return;
    expect(result.plan.mode).toBe('all');
    expect(result.plan.vault).toBe(vet?.vault);
    const decoded = decode(result.plan.call.data);
    expect(decoded.functionName).toBe('redeem');
    expect(decoded.args).toEqual([123n, SAFE, SAFE]);
    // "all" needs no stated USDC amount for the pre-flight.
    expect(reader).toHaveBeenCalledWith(
      expect.objectContaining({ amountUnits: null, vault: vet?.vault }),
    );
  });
});

describe('prepareMorphoVaultWithdraw — the share pre-flight', () => {
  it('refuses before building when the shares cannot cover the requested USDC, with no plan', async () => {
    const reader = vi.fn(
      async (): Promise<SafeVaultShareRead> => ({
        status: 'read',
        shares: 1n,
        assetsUsdc: 0n,
      }),
    );
    const result = await prepareMorphoVaultWithdraw(
      { safeAddress: SAFE, amount: { kind: 'partial', amountUsdc: '10' }, chainId: 1 },
      { env: {}, railConfigured: true, sharesReader: reader },
    );

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('safe-insufficient-shares');
      expect(result.reason).toMatch(/Ethereum/);
      expect(result.reason).toMatch(/short by 10 USDC/);
      // The whole point: no plan was built against an under-funded position.
      expect(result.plan).toBeUndefined();
    }
  });

  it('refuses an unreadable share balance with the real reason, never a pass', async () => {
    const reader = vi.fn(
      async (): Promise<SafeVaultShareRead> => ({
        status: 'failed',
        reason: 'the vault share balance read failed: RPC timed out',
      }),
    );
    const result = await prepareMorphoVaultWithdraw(
      { safeAddress: SAFE, amount: { kind: 'all' }, chainId: 1 },
      { env: {}, railConfigured: true, sharesReader: reader },
    );

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('safe-shares-unreadable');
      expect(result.reason).toMatch(/RPC timed out/);
      expect(result.plan).toBeUndefined();
    }
  });

  it('refuses "all" of an empty position before building', async () => {
    const reader = sufficient(0n, 0n);
    const result = await prepareMorphoVaultWithdraw(
      { safeAddress: SAFE, amount: { kind: 'all' }, chainId: 1 },
      { env: {}, railConfigured: true, sharesReader: reader },
    );

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('safe-insufficient-shares');
      expect(result.plan).toBeUndefined();
    }
  });
});

describe('prepareMorphoVaultWithdraw — chain gates', () => {
  it('refuses a chain with no pinned vault, naming the chain, before any read', async () => {
    const reader = sufficient();
    const result = await prepareMorphoVaultWithdraw(
      { safeAddress: SAFE, amount: { kind: 'partial', amountUsdc: '10' }, chainId: 84532 },
      { env: {}, railConfigured: true, sharesReader: reader },
    );

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('vault-not-configured');
      expect(result.reason).toContain('84532');
      expect(result.plan).toBeUndefined();
    }
    // The configuration gate stops first: nothing is read from a chain with no
    // vault at all.
    expect(reader).not.toHaveBeenCalled();
  });

  it('refuses a chain whose rail is missing, naming that chain', async () => {
    const reader = sufficient();
    const result = await prepareMorphoVaultWithdraw(
      { safeAddress: SAFE, amount: { kind: 'partial', amountUsdc: '10' }, chainId: 42161 },
      { env: {}, railConfigured: false, sharesReader: reader },
    );

    expect(result.status).toBe('gated');
    if (result.status === 'gated') {
      expect(result.gate).toBe('rail-not-configured');
      expect(result.reason).toMatch(/Arbitrum One/);
      expect(result.plan).toBeUndefined();
    }
    expect(reader).not.toHaveBeenCalled();
  });
});
