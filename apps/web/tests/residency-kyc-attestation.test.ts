import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeAbiParameters } from 'viem';
import { EAS_SCHEMAS, encodeSchema } from '@kade/shared';
import {
  assertKycIssuanceApproved,
  encodeKycAttestationData,
  kycSchemaDefinition,
  prepareKycAttestation,
  readKycIssuanceGate,
  type KycFields,
} from '@/lib/residency/kyc-attestation';

/**
 * The kade.kyc.v1 preparation path. The encoding is taken from the frozen shared
 * schema; preparation is gated, and every result is explicitly unsent because
 * this build has no broadcast path.
 */

afterEach(() => {
  vi.unstubAllEnvs();
});

const NULLIFIER = `0x${'ab'.repeat(32)}` as const;

function fields(overrides: Partial<KycFields> = {}): KycFields {
  return {
    nationality: 'NL',
    over18: true,
    notSanctioned: true,
    selfNullifier: NULLIFIER,
    expiresAt: 1_900_000_000,
    ...overrides,
  };
}

describe('kycSchemaDefinition', () => {
  it('is the frozen shared schema, field order included', () => {
    const definition = kycSchemaDefinition();
    expect(definition.name).toBe('kade.kyc.v1');
    expect(definition.schema).toBe(encodeSchema(EAS_SCHEMAS['kade.kyc.v1']));
    expect(definition.fields.map((f) => f.name)).toEqual([
      'nationality',
      'over18',
      'notSanctioned',
      'selfNullifier',
      'expiresAt',
    ]);
    expect(definition.fields.map((f) => f.type)).toEqual([
      'string',
      'bool',
      'bool',
      'bytes32',
      'uint64',
    ]);
  });
});

describe('encodeKycAttestationData', () => {
  it('round-trips the kyc fields in schema order', () => {
    const data = encodeKycAttestationData(fields());

    const [nationality, over18, notSanctioned, selfNullifier, expiresAt] =
      decodeAbiParameters(
        EAS_SCHEMAS['kade.kyc.v1'].fields.map((field) => ({
          name: field.name,
          type: field.type,
        })),
        data,
      );

    expect(nationality).toBe('NL');
    expect(over18).toBe(true);
    expect(notSanctioned).toBe(true);
    expect(selfNullifier).toBe(NULLIFIER);
    expect(expiresAt).toBe(1_900_000_000n);
  });

  it('rejects a nationality that is not an alpha-2 code', () => {
    expect(() => encodeKycAttestationData(fields({ nationality: 'NLD' }))).toThrow(
      /alpha-2/,
    );
    expect(() => encodeKycAttestationData(fields({ nationality: '' }))).toThrow(
      /alpha-2/,
    );
  });

  it('rejects a self nullifier that is not a 32-byte hex value', () => {
    expect(() =>
      encodeKycAttestationData(fields({ selfNullifier: '0x1234' as never })),
    ).toThrow(/32-byte/);
  });

  it('rejects an expiry that does not fit a uint64', () => {
    expect(() => encodeKycAttestationData(fields({ expiresAt: -1 }))).toThrow(
      /expiresAt/,
    );
    expect(() =>
      encodeKycAttestationData(fields({ expiresAt: 2 ** 64 })),
    ).toThrow(/uint64/);
  });
});

describe('prepareKycAttestation', () => {
  it('is not-configured and unsent when no approval is recorded', () => {
    const result = prepareKycAttestation(fields(), null);
    expect(result.status).toBe('not-configured');
    expect(result.sent).toBe(false);
    expect(result).not.toHaveProperty('payload');
  });

  it('is blocked and unsent when the gate is not approved', () => {
    const result = prepareKycAttestation(fields(), {
      onchainGateApproved: false,
    });
    expect(result.status).toBe('blocked');
    expect(result.sent).toBe(false);
    if (result.status === 'blocked') {
      expect(result.reason).toMatch(/Onchain gate/i);
    }
  });

  it('prepares a valid, unsent payload when the gate is approved', () => {
    const result = prepareKycAttestation(fields(), {
      onchainGateApproved: true,
    });
    expect(result.status).toBe('prepared');
    expect(result.sent).toBe(false);
    if (result.status === 'prepared') {
      expect(result.payload).toMatch(/^0x[0-9a-f]+$/i);
      expect(result.reason).toMatch(/NOT sent/i);
    }
  });

  it('blocks an unencodable payload rather than preparing a wrong one', () => {
    const result = prepareKycAttestation(fields({ nationality: 'NLD' }), {
      onchainGateApproved: true,
    });
    expect(result.status).toBe('blocked');
    expect(result.sent).toBe(false);
  });
});

describe('assertKycIssuanceApproved', () => {
  it('throws only without approval', () => {
    expect(() =>
      assertKycIssuanceApproved({
        onchainGateApproved: false,
      }),
    ).toThrow(/Onchain gate/i);

    expect(() =>
      assertKycIssuanceApproved({
        onchainGateApproved: true,
      }),
    ).not.toThrow();
  });
});

describe('readKycIssuanceGate', () => {
  it('is null when the approval is not recorded', () => {
    expect(readKycIssuanceGate()).toBeNull();
  });

  it('reads the recorded approval from the single flag', () => {
    vi.stubEnv('KADE_KYC_ISSUANCE_APPROVED', 'true');
    expect(readKycIssuanceGate()).toEqual({
      onchainGateApproved: true,
    });
  });
});
