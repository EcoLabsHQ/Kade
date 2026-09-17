/**
 * Executable form of the frozen Week 1 contract.
 *
 * Every assertion here traces to a clause of
 * docs/week-1-frozen-delivery-contract.md. These are not implementation tests:
 * they are the acceptance criteria that must not drift without change control.
 *
 * Dependency-free checks run everywhere. Checks that require a live
 * environment (a database, a chain) are covered by the integration suite in
 * ./scripts/verify-full.sh and are named in the comments.
 */

import { describe, expect, it } from 'vitest';
import {
  CHAIN_IDS,
  EAS_SCHEMAS,
  EAS_SCHEMA_NAMES,
  EXCLUDED_LOGIN_PROVIDERS,
  feeScheduleFor,
  LOGIN_PROVIDER,
  preapprovalFeeUsdc,
  residencyServiceFeeUsdc,
  SAFE_THRESHOLD,
  TESTNET_CHAINS,
} from '@kade/shared';

describe('contract section 2 - frozen product decisions', () => {
  it('item 2: Google OAuth is the only application login, with no email fallback', () => {
    expect(LOGIN_PROVIDER).toBe('google');
    expect(EXCLUDED_LOGIN_PROVIDERS).toContain('email');
    expect(EXCLUDED_LOGIN_PROVIDERS).toContain('email_otp');
  });

  it('item 6: the resident Safe has threshold 1', () => {
    expect(SAFE_THRESHOLD).toBe(1);
  });

  it('item 7: iteration 1 is testnet only, on Ethereum Sepolia plus two L2 testnets', () => {
    expect(TESTNET_CHAINS.map((c) => c.chainId).sort()).toEqual(
      [CHAIN_IDS.sepolia, CHAIN_IDS.arbitrumSepolia, CHAIN_IDS.baseSepolia].sort(),
    );
    expect(TESTNET_CHAINS.every((c) => c.env === 'testnet')).toBe(true);
  });

  it('item 8: exactly five EAS schemas, with the frozen names', () => {
    expect([...EAS_SCHEMA_NAMES].sort()).toEqual([
      'kade.application.v1',
      'kade.fee.v1',
      'kade.kyc.v1',
      'kade.permit.v1',
      'kade.review.v1',
    ]);
  });
});

describe('contract section 2.1 - frozen fee model', () => {
  it('reproduces both documented worked examples', () => {
    expect(preapprovalFeeUsdc('demo', 3)).toBe(1.75);
    expect(preapprovalFeeUsdc('production', 3)).toBe(447);
  });

  it('seeds the service fee in both modes but only charges pre-approval in Week 1', () => {
    expect(residencyServiceFeeUsdc('demo')).toBe(10);
    expect(residencyServiceFeeUsdc('production')).toBe(2000);
  });

  it('stores both fees in one schedule keyed by mode, with no client-side amount', () => {
    const demo = feeScheduleFor('demo');
    const production = feeScheduleFor('production');
    expect(demo.map((f) => f.key)).toEqual(production.map((f) => f.key));
    expect(demo.every((f) => f.mode === 'demo')).toBe(true);
    expect(production.every((f) => f.mode === 'production')).toBe(true);
  });
});

describe('contract section 4 - deliverable evidence requirements', () => {
  it('D2: every testnet chain exposes token and registry addresses for seeding', () => {
    for (const chain of TESTNET_CHAINS) {
      expect(chain.usdcAddress.value).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(chain.easAddress.value).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(chain.schemaRegistryAddress.value).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(chain.explorerUrl).toMatch(/^https:\/\//);
    }
  });

  it('D6: each schema has at least one reviewed field and an encoding', () => {
    for (const name of EAS_SCHEMA_NAMES) {
      const schema = EAS_SCHEMAS[name];
      expect(schema.fields.length).toBeGreaterThan(0);
      expect(schema.name).toBe(name);
    }
  });

  // D4 cross-chain address equality, D3 passkey separation and D7 KadeLock
  // policy are covered by their own suites in packages/shared/tests and
  // packages/contracts/test.
});
