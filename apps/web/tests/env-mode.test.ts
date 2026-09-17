import { afterEach, describe, expect, it, vi } from 'vitest';
import { readChainEnv, readFeeMode } from '@/lib/env';

/**
 * The two behaviour switches must actually be read.
 *
 * `docs/architecture/adr/0005-config-over-code.md` and `README.md` present
 * KADE_FEE_MODE and KADE_CHAIN_ENV as the switches that select the active fee
 * schedule and chain set. Before this test existed, neither was read anywhere:
 * the onboarding page hard-coded the demo mode, so setting KADE_FEE_MODE had no
 * effect while the documentation said it did.
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('readFeeMode', () => {
  it('defaults to the demo schedule for iteration 1', () => {
    delete process.env.KADE_FEE_MODE;
    expect(readFeeMode()).toBe('demo');
  });

  it('reads production when configured', () => {
    process.env.KADE_FEE_MODE = 'production';
    expect(readFeeMode()).toBe('production');
  });

  it('tolerates surrounding whitespace', () => {
    process.env.KADE_FEE_MODE = '  production  ';
    expect(readFeeMode()).toBe('production');
  });

  it('falls back to demo and warns on an unknown value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.KADE_FEE_MODE = 'staging';
    expect(readFeeMode()).toBe('demo');
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('readChainEnv', () => {
  it('defaults to testnet, which is the iteration-1 setting', () => {
    delete process.env.KADE_CHAIN_ENV;
    expect(readChainEnv()).toBe('testnet');
  });

  it('reads mainnet when configured', () => {
    process.env.KADE_CHAIN_ENV = 'mainnet';
    expect(readChainEnv()).toBe('mainnet');
  });

  it('falls back to testnet and warns on an unknown value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.KADE_CHAIN_ENV = 'devnet';
    expect(readChainEnv()).toBe('testnet');
    expect(warn).toHaveBeenCalledOnce();
  });
});
