import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, getAddress, isAddress } from 'viem';
import {
  MORPHO_VAULT_ENV_KEYS,
  readMorphoVaultConfig,
  type MorphoEnv,
} from '@/lib/invest/morpho-config';
import { METAMORPHO_VAULT_ABI } from '@/lib/invest/morpho-abi';

/**
 * The Morpho rail's address normalisation (T20).
 *
 * `KADE_MORPHO_VAULT_ADDRESS` is supplied with a **wrong EIP-55 checksum**
 * (`…46AA9Aa4…`); the canonical form is `…46AA9aA4…`. viem's ABI encoder
 * (`encodeFunctionData`, and therefore `readContract`) rejects the wrong form
 * with `InvalidAddressError`, so the MetaMorpho position read can never
 * succeed. `readMorphoVaultConfig` must therefore hand out a value viem
 * accepts, be robust against the next mis-typed value, and stop being silent
 * about a genuinely malformed one.
 *
 * These tests are offline: no RPC, no network, no signing.
 */

/** The project-supplied vault value, exactly as it reaches the environment. */
const CONFIGURED_VAULT = '0xBEEF01735c132Ada46AA9Aa4C54623cAA92A64CB';
/** Its canonical EIP-55 form — the address itself is unchanged. */
const NORMALISED_VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';
/** Canonical mainnet USDC; a second address the rail normalises. */
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

function env(values: Record<string, string | undefined>): MorphoEnv {
  return values;
}

const CONFIGURED = env({
  [MORPHO_VAULT_ENV_KEYS.vault]: CONFIGURED_VAULT,
  [MORPHO_VAULT_ENV_KEYS.usdc]: USDC,
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readMorphoVaultConfig normalises addresses for viem', () => {
  it('hands out a vault address viem accepts and that round-trips through getAddress unchanged', () => {
    const config = readMorphoVaultConfig(CONFIGURED);

    expect(config).not.toBeNull();
    expect(getAddress(config!.vault)).toBe(config!.vault);
    expect(isAddress(config!.vault, { strict: true })).toBe(true);

    // The actual failure mode: the ABI encoder must accept the address.
    expect(() =>
      encodeFunctionData({
        abi: METAMORPHO_VAULT_ABI,
        functionName: 'balanceOf',
        args: [config!.vault],
      }),
    ).not.toThrow();
  });

  it('pins the normalised vault address so it cannot silently regress', () => {
    const config = readMorphoVaultConfig(CONFIGURED);

    expect(config?.vault).toBe('0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB');
    expect(config?.vault).toBe(NORMALISED_VAULT);
  });

  it('normalises a non-checksummed USDC address too', () => {
    const config = readMorphoVaultConfig(
      env({
        [MORPHO_VAULT_ENV_KEYS.vault]: CONFIGURED_VAULT,
        [MORPHO_VAULT_ENV_KEYS.usdc]: USDC.toLowerCase(),
      }),
    );

    expect(config?.usdc).toBe(USDC);
    expect(getAddress(config!.usdc)).toBe(config!.usdc);
  });

  it('fails loudly, naming KADE_MORPHO_VAULT_ADDRESS, for a malformed vault value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      readMorphoVaultConfig(
        env({ [MORPHO_VAULT_ENV_KEYS.vault]: '0x1234', [MORPHO_VAULT_ENV_KEYS.usdc]: USDC }),
      ),
    ).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(MORPHO_VAULT_ENV_KEYS.vault),
    );
  });

  it('fails loudly, naming KADE_MORPHO_USDC_ADDRESS, for a malformed USDC value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      readMorphoVaultConfig(
        env({ [MORPHO_VAULT_ENV_KEYS.vault]: CONFIGURED_VAULT, [MORPHO_VAULT_ENV_KEYS.usdc]: '0xnope' }),
      ),
    ).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(MORPHO_VAULT_ENV_KEYS.usdc),
    );
  });

  it('stays quiet and not-configured when a key is simply absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Absence is a legitimate "not configured" state, not a misconfiguration.
    expect(readMorphoVaultConfig(env({ [MORPHO_VAULT_ENV_KEYS.vault]: CONFIGURED_VAULT }))).toBeNull();
    expect(readMorphoVaultConfig(env({ [MORPHO_VAULT_ENV_KEYS.usdc]: USDC }))).toBeNull();
    expect(readMorphoVaultConfig(env({}))).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});
