import { describe, expect, it } from 'vitest';
import {
  assertRegistrationApproved,
  EAS_SCHEMAS,
  EAS_SCHEMA_NAMES,
  encodeSchema,
  registrationManifest,
} from '../src/index.js';

describe('EAS schemas', () => {
  it('defines exactly the five frozen schema names', () => {
    expect([...EAS_SCHEMA_NAMES]).toEqual([
      'kade.kyc.v1',
      'kade.fee.v1',
      'kade.application.v1',
      'kade.review.v1',
      'kade.permit.v1',
    ]);
    expect(Object.keys(EAS_SCHEMAS).sort()).toEqual([...EAS_SCHEMA_NAMES].sort());
  });

  it('encodes a schema in canonical EAS form, preserving field order', () => {
    expect(encodeSchema(EAS_SCHEMAS['kade.kyc.v1'])).toBe(
      'string nationality,bool over18,bool notSanctioned,bytes32 selfNullifier,uint64 expiresAt',
    );
  });

  it('does not store a raw proof payload in the KYC schema', () => {
    // Contract D6 and the build guide: proofs, not documents.
    const encoded = encodeSchema(EAS_SCHEMAS['kade.kyc.v1']).toLowerCase();
    expect(encoded).not.toContain('passport');
    expect(encoded).not.toContain('proof');
    expect(encoded).toContain('selfnullifier');
  });

  it('produces a registration manifest the Onchain gate can review', () => {
    const manifest = registrationManifest();
    expect(manifest).toHaveLength(5);
    for (const entry of manifest) {
      expect(entry.schema).not.toBe('');
      expect(typeof entry.revocable).toBe('boolean');
    }
  });
});

describe('EAS registration guard', () => {
  it('blocks registration without an approved Onchain gate', () => {
    expect(() =>
      assertRegistrationApproved({ onchainGateApproved: false, approvedBy: '', approvedAt: '' }),
    ).toThrow(/Onchain gate/);
  });

  it('blocks registration without a recorded approver and timestamp', () => {
    expect(() =>
      assertRegistrationApproved({ onchainGateApproved: true, approvedBy: '', approvedAt: '' }),
    ).toThrow(/who approved/);
  });

  it('permits registration once the gate is approved and recorded', () => {
    expect(() =>
      assertRegistrationApproved({
        onchainGateApproved: true,
        approvedBy: 'human-reviewer',
        approvedAt: '2026-09-20T00:00:00Z',
      }),
    ).not.toThrow();
  });
});
