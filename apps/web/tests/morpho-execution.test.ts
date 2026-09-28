import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { prepareMorphoVaultDeposit } from '@/lib/invest/morpho-execution';
import { MORPHO_VAULT_ENV_KEYS } from '@/lib/invest/morpho-config';

/**
 * The config-gated MetaMorpho vault **build** boundary (D18 / EXE-014).
 *
 * The point of these tests is that the engine refuses to pretend: with the vault
 * or the mainnet rail missing it returns a gated outcome, and when both are
 * present it returns the built plan as `ready-to-execute` — never a deposit.
 * There is no signer gate any more: the passkey needs no deployment, and signing
 * is the separate two-phase flow owned by the server actions. No network, no
 * signing.
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

  it('builds the plan as ready-to-execute once the vault and rail are set, with no signer', async () => {
    // No signer is supplied and none is required: the passkey is the Safe owner
    // and needs no deployment. Building is a pure server-side step.
    const result = await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: true,
    });
    expect(result.status).toBe('ready-to-execute');
    expect(result.gated).toBe(true);
    if (result.status === 'ready-to-execute') {
      expect(result.plan.calls).toHaveLength(2);
      expect(result.plan.vault).toBe(VAULT);
      expect(result.plan.chainId).toBe(1);
    }
  });

  it('never reports a sent transaction', async () => {
    const result = await prepareMorphoVaultDeposit(REQUEST, {
      env: COMPLETE_ENV,
      mainnetConfigured: true,
    });
    expect(['gated', 'ready-to-execute']).toContain(result.status);
    expect(result).not.toHaveProperty('transactionHash');
  });

  it('treats a malformed amount as a gate refusal, not a sent transaction', async () => {
    const result = await prepareMorphoVaultDeposit(
      { safeAddress: SAFE, amountUsdc: '0' },
      { env: COMPLETE_ENV, mainnetConfigured: true },
    );
    expect(result.status).toBe('gated');
    expect(result.gated).toBe(true);
  });

  it('refuses a wrong chain when the caller names one', async () => {
    const result = await prepareMorphoVaultDeposit(
      { safeAddress: SAFE, amountUsdc: '25000', chainId: 11155111 },
      { env: COMPLETE_ENV, mainnetConfigured: true },
    );
    expect(result.status).toBe('gated');
    expect(result.gated).toBe(true);
  });
});
