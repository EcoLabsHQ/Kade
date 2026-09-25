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

const SIGNER = {
  rawId: 'cred-1',
  coordinates: { x: '1', y: '2' },
  verifierAddress: '0x4444444444444444444444444444444444444444',
} as const;

const REQUEST = { safeAddress: SAFE, amountUsdc: '25000' } as const;

describe('prepareMorphoVaultDeposit', () => {
  it('is gated on the vault when no KADE_MORPHO_* configuration exists', async () => {
    const result = await prepareMorphoVaultDeposit(REQUEST, {
      env: {},
      mainnetConfigured: true,
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
    });
    expect(result.status).toBe('gated');
    if (result.status === 'gated') expect(result.gate).toBe('mainnet-not-configured');
  });

  it('is gated when no passkey signer is available to authorise the Safe', async () => {
    // The passkey is the Safe's owner, so an absent signer means nothing can
    // authorise the deposit. There is no signer contract to wait on any more.
    const result = await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: true,
    });
    expect(result.status).toBe('gated');
    if (result.status === 'gated') expect(result.gate).toBe('signer-not-deployed');
  });

  it('builds the plan and stops before sending when the bundler is not configured', async () => {
    // A signer alone is not enough to send: without the Pimlico keys there is
    // no sponsored bundler, so the engine refuses. The plan is still returned.
    const result = await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: true,
      safeExecution: { signer: SIGNER, safeAddress: SAFE },
    });
    expect(result.status).toBe('gated');
    expect(result.gated).toBe(true);
    expect(result.plan?.calls).toHaveLength(2);
    expect(result.plan?.vault).toBe(VAULT);
  });

  it('invokes the injected Safe execution callback only once every gate is open', async () => {
    const execute = vi.fn(async () => ({ txHash: `0x${'ab'.repeat(32)}` as const }));
    await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: true,
      safeExecution: { signer: SIGNER, safeAddress: SAFE },
      execute,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('never invokes the callback when a gate is closed', async () => {
    const execute = vi.fn(async () => ({ txHash: `0x${'ab'.repeat(32)}` as const }));
    await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: false,
      execute,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('treats a malformed amount as a gate refusal, not a sent transaction', async () => {
    const execute = vi.fn(async () => ({ txHash: `0x${'ab'.repeat(32)}` as const }));
    const result = await prepareMorphoVaultDeposit(
      { safeAddress: SAFE, amountUsdc: '0' },
      { env: COMPLETE_ENV, mainnetConfigured: true, execute },
    );
    expect(result.status).toBe('gated');
    expect(execute).not.toHaveBeenCalled();
  });
});
