import { afterEach, describe, expect, it, vi } from 'vitest';
import { EAS_SCHEMAS } from '@kade/shared';
import {
  SELF_DISCLOSURES,
  buildSelfVerificationRequest,
  isSelfVerificationConfigured,
  readSelfConfig,
  startSelfVerification,
} from '@/lib/residency/self';

/**
 * The Self identity path is config-gated and never fabricates a KYC result.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

function configure() {
  vi.stubEnv('KADE_SELF_APP_ID', 'kade-app');
  vi.stubEnv('KADE_SELF_SCOPE', 'residency');
  vi.stubEnv('KADE_SELF_VERIFIER_ADDRESS', '0x1111111111111111111111111111111111111111');
  vi.stubEnv('KADE_SELF_CHAIN_ID', '1');
}

describe('readSelfConfig', () => {
  it('is null without the Self configuration', () => {
    expect(readSelfConfig()).toBeNull();
    expect(isSelfVerificationConfigured()).toBe(false);
  });

  it('rejects a malformed verifier address', () => {
    configure();
    vi.stubEnv('KADE_SELF_VERIFIER_ADDRESS', 'not-an-address');
    expect(readSelfConfig()).toBeNull();
  });

  it('reads the supplied configuration', () => {
    configure();
    expect(readSelfConfig()).toEqual({
      appId: 'kade-app',
      scope: 'residency',
      verifierAddress: '0x1111111111111111111111111111111111111111',
      chainId: 1,
    });
    expect(isSelfVerificationConfigured()).toBe(true);
  });
});

describe('SELF_DISCLOSURES', () => {
  it('is exactly the frozen kade.kyc.v1 fields, in order', () => {
    expect(SELF_DISCLOSURES).toEqual(
      EAS_SCHEMAS['kade.kyc.v1'].fields.map((field) => field.name),
    );
  });
});

describe('startSelfVerification', () => {
  it('reports not-configured when Self is absent', () => {
    expect(startSelfVerification(null)).toEqual({ status: 'not-configured' });
  });

  it('never reports verified in this build, even when configured', () => {
    const outcome = startSelfVerification({
      appId: 'kade-app',
      scope: 'residency',
      verifierAddress: '0x1111111111111111111111111111111111111111',
      chainId: 1,
    });
    expect(outcome.status).toBe('unavailable');
    if (outcome.status === 'unavailable') {
      expect(outcome.reason).toMatch(/not wired/i);
    }
  });
});

describe('buildSelfVerificationRequest', () => {
  it('names the frozen disclosure set', () => {
    const request = buildSelfVerificationRequest({
      appId: 'kade-app',
      scope: 'residency',
      verifierAddress: '0x1111111111111111111111111111111111111111',
      chainId: 1,
    });
    expect(request.disclosures).toEqual(SELF_DISCLOSURES);
    expect(request.disclosures).toContain('selfNullifier');
  });
});
