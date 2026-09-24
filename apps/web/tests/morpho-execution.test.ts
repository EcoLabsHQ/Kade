import { describe, expect, it, vi } from 'vitest';
import { getAddress } from 'viem';
import { prepareMorphoVaultDeposit } from '@/lib/invest/morpho-execution';
import { MORPHO_VAULT_ENV_KEYS } from '@/lib/invest/morpho-config';

/**
 * The config-gated MetaMorpho vault execution boundary (D18 / EXE-014).
 *
 * The point of these tests is that the engine **refuses** to pretend: with the
 * vault, mainnet or signer missing it returns a gated outcome and sends nothing,
 * and it never invokes a Safe execution callback unless every gate is open and a
 * post-gate caller supplied one. No network, no signing.
 */

const VAULT = getAddress('0x1111222233334444555566667777888899990000');
const USDC = getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const SAFE = getAddress('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');

const COMPLETE_ENV = {
  [MORPHO_VAULT_ENV_KEYS.vault]: VAULT,
  [MORPHO_VAULT_ENV_KEYS.usdc]: USDC,
} as const;

const REQUEST = { safeAddress: SAFE, amountUsdc: '25000' } as const;

describe('prepareMorphoVaultDeposit', () => {
  it('is gated on the vault when no KADE_MORPHO_* configuration exists', async () => {
    const result = await prepareMorphoVaultDeposit(REQUEST, {
      env: {},
      mainnetConfigured: true,
      signerDeployed: true,
    });
    expect(result.status).toBe('gated');
    expect(result.gated).toBe(true);
    if (result.status === 'gated') {
      expect(result.gate).toBe('vault-not-configured');
      expect(result.plan).toBeUndefined();
    }
  });

  it('is gated on mainnet even when the vault is configured', async () => {
    const result = await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: false,
      signerDeployed: true,
    });
    expect(result.status).toBe('gated');
    if (result.status === 'gated') expect(result.gate).toBe('mainnet-not-configured');
  });

  it('is gated on the signer when vault and mainnet are present but the signer is not deployed', async () => {
    const result = await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: true,
      signerDeployed: false,
    });
    expect(result.status).toBe('gated');
    if (result.status === 'gated') expect(result.gate).toBe('signer-not-deployed');
  });

  it('builds the plan but sends nothing when all gates are open and no callback is wired', async () => {
    const result = await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: true,
      signerDeployed: true,
    });
    // Every gate is open, but this build still sends nothing: `ready-to-execute`
    // carries the plan and `gated: true` states no transaction was broadcast.
    expect(result.status).toBe('ready-to-execute');
    expect(result.gated).toBe(true);
    if (result.status === 'ready-to-execute') {
      expect(result.plan.calls).toHaveLength(2);
      expect(result.plan.vault).toBe(VAULT);
      expect(result.plan.safeAddress).toBe(SAFE);
    }
  });

  it('invokes the injected Safe execution callback only once every gate is open', async () => {
    const execute = vi.fn(async () => ({ txHash: `0x${'ab'.repeat(32)}` as const }));
    await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: true,
      signerDeployed: true,
      execute,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('never invokes the callback when a gate is closed', async () => {
    const execute = vi.fn(async () => ({ txHash: `0x${'ab'.repeat(32)}` as const }));
    await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: false,
      signerDeployed: true,
      execute,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('treats a malformed amount as a gate refusal, not a sent transaction', async () => {
    const execute = vi.fn(async () => ({ txHash: `0x${'ab'.repeat(32)}` as const }));
    const result = await prepareMorphoVaultDeposit(
      { safeAddress: SAFE, amountUsdc: '0' },
      { env: COMPLETE_ENV, mainnetConfigured: true, signerDeployed: true, execute },
    );
    expect(result.status).toBe('gated');
    expect(execute).not.toHaveBeenCalled();
  });
});
