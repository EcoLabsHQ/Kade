import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeAbiParameters } from 'viem';
import { EAS_SCHEMAS, encodeSchema } from '@kade/shared';
import {
  assertPermitIssuanceApproved,
  encodePermitAttestationData,
  issuePermit,
  permitSchemaDefinition,
  readPermitIssuanceGate,
} from '@/lib/residency/permit';

/**
 * The kade.permit.v1 issuance path. The encoding is taken from the frozen
 * shared schema; issuance is gated and never writes in this build.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('permitSchemaDefinition', () => {
  it('is the frozen shared schema, field order included', () => {
    const definition = permitSchemaDefinition();
    expect(definition.name).toBe('kade.permit.v1');
    expect(definition.schema).toBe(encodeSchema(EAS_SCHEMAS['kade.permit.v1']));
    expect(definition.fields.map((f) => f.name)).toEqual([
      'applicationRef',
      'tier',
      'validUntil',
    ]);
    expect(definition.fields.map((f) => f.type)).toEqual([
      'string',
      'string',
      'uint64',
    ]);
  });
});

describe('encodePermitAttestationData', () => {
  it('round-trips the permit fields in schema order', () => {
    const data = encodePermitAttestationData({
      applicationRef: 'CW-2026-0409',
      tier: '3-year',
      validUntil: 1_800_000_000,
    });

    const [applicationRef, tier, validUntil] = decodeAbiParameters(
      EAS_SCHEMAS['kade.permit.v1'].fields.map((field) => ({
        name: field.name,
        type: field.type,
      })),
      data,
    );

    expect(applicationRef).toBe('CW-2026-0409');
    expect(tier).toBe('3-year');
    expect(validUntil).toBe(1_800_000_000n);
  });
});

describe('issuePermit', () => {
  it('is not-configured when no approval is recorded', () => {
    const result = issuePermit(null);
    expect(result.status).toBe('not-configured');
  });

  it('is blocked when the gate is not approved', () => {
    const result = issuePermit({
      onchainGateApproved: false,
      approvedBy: 'owner',
      approvedAt: '2026-09-22',
    });
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toMatch(/Onchain gate/i);
    }
  });

  it('still does not write when the gate is approved in this build', () => {
    const result = issuePermit({
      onchainGateApproved: true,
      approvedBy: 'owner',
      approvedAt: '2026-09-22',
    });
    expect(result.status).toBe('blocked');
  });
});

describe('assertPermitIssuanceApproved', () => {
  it('throws without approval, and without an approver', () => {
    expect(() =>
      assertPermitIssuanceApproved({
        onchainGateApproved: false,
        approvedBy: '',
        approvedAt: '',
      }),
    ).toThrow(/Onchain gate/i);

    expect(() =>
      assertPermitIssuanceApproved({
        onchainGateApproved: true,
        approvedBy: '',
        approvedAt: '',
      }),
    ).toThrow(/who approved/i);
  });
});

describe('readPermitIssuanceGate', () => {
  it('is null when the approval is not recorded', () => {
    expect(readPermitIssuanceGate()).toBeNull();
  });

  it('reads the recorded approval', () => {
    vi.stubEnv('KADE_PERMIT_ISSUANCE_APPROVED', 'true');
    vi.stubEnv('KADE_PERMIT_ISSUANCE_APPROVED_BY', 'owner');
    vi.stubEnv('KADE_PERMIT_ISSUANCE_APPROVED_AT', '2026-09-22');
    expect(readPermitIssuanceGate()).toEqual({
      onchainGateApproved: true,
      approvedBy: 'owner',
      approvedAt: '2026-09-22',
    });
  });
});
