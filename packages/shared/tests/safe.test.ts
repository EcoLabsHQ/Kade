import { describe, expect, it } from 'vitest';
import {
  assertPasskeyOnlyOwnership,
  assertSameAddressAcrossChains,
  assertThresholdOne,
  SAFE_THRESHOLD,
  type SafeDeploymentRecord,
} from '../src/index.js';

const SAFE = '0x5Af1000000000000000000000000000000000c09D' as const;
const OTHER = '0x1111111111111111111111111111111111111111' as const;

/**
 * The active iteration-1 set (contract v1.6): Ethereum Sepolia is deployed,
 * Base Sepolia is predicted. Arbitrum is deferred, so it is deliberately not
 * part of this default fixture — see the chain-identity test below.
 */
function records(address = SAFE): SafeDeploymentRecord[] {
  return [
    { chainId: 11155111, safeAddress: address, deploymentTxHash: '0xabc' as const, predicted: false },
    { chainId: 84532, safeAddress: address, deploymentTxHash: null, predicted: true },
  ];
}

describe('deterministic Safe address (D4)', () => {
  it('accepts the same address on every active chain', () => {
    expect(() => assertSameAddressAcrossChains(records())).not.toThrow();
  });

  it('ignores chain identity, so a deferred chain resolves identically', () => {
    // The check must not read the chain id. D4 relies on the chain-agnostic
    // salt, so probing with a chain that is *not* in the active set is a
    // stronger assertion than probing with another active one.
    const withDeferred: SafeDeploymentRecord[] = [
      ...records(),
      { chainId: 421614, safeAddress: SAFE, deploymentTxHash: null, predicted: true },
    ];
    expect(() => assertSameAddressAcrossChains(withDeferred)).not.toThrow();
  });

  it('rejects an address mismatch across chains', () => {
    const mismatched = records();
    mismatched[1] = { ...mismatched[1]!, safeAddress: OTHER };
    expect(() => assertSameAddressAcrossChains(mismatched)).toThrow(/mismatch/);
  });

  it('is case-insensitive when comparing addresses', () => {
    const mixed = records();
    mixed[1] = { ...mixed[1]!, safeAddress: SAFE.toLowerCase() as `0x${string}` };
    expect(() => assertSameAddressAcrossChains(mixed)).not.toThrow();
  });
});

describe('Safe ownership (D4)', () => {
  it('accepts the passkey signer as the only owner', () => {
    expect(() => assertPasskeyOnlyOwnership([SAFE], SAFE)).not.toThrow();
  });

  it('rejects more than one owner', () => {
    expect(() => assertPasskeyOnlyOwnership([SAFE, OTHER], SAFE)).toThrow(/exactly 1 owner/);
  });

  it('rejects an owner that is not the passkey signer', () => {
    expect(() => assertPasskeyOnlyOwnership([OTHER], SAFE)).toThrow(/passkey signer/);
  });

  it('rejects a user EOA as the passkey signer', () => {
    expect(() => assertPasskeyOnlyOwnership([SAFE], SAFE, [SAFE])).toThrow(/must not be a user EOA/);
  });

  it('freezes the threshold at 1', () => {
    expect(SAFE_THRESHOLD).toBe(1);
    expect(() => assertThresholdOne(1)).not.toThrow();
    expect(() => assertThresholdOne(2)).toThrow(/threshold/);
  });
});
