import { encodeAbiParameters, type Hex } from 'viem';
import { EAS_SCHEMAS, encodeSchema, type EasSchemaName } from '@kade/shared';

/**
 * The `kade.kyc.v1` identity-attestation path (D16 / EXE-012).
 *
 * Self now verifies the proof in **backend (off-chain) mode** and delivers the
 * disclosed facts by webhook (`./self-event`, stored by
 * `20260924000010_self_verification_facts.sql`). This module is the next step,
 * and it stops at the same boundary `./permit` does: it builds the attestation
 * payload from the **frozen** shared schema (`EAS_SCHEMAS['kade.kyc.v1']`), so
 * field order and types come from there and can never drift, and it requires an
 * explicit approval gate before it will even prepare. It does **not** sign,
 * **does not** call `writeContract`, and **does not** broadcast.
 *
 * **GATED: kade.kyc.v1 issuance.** The schema is registered on Ethereum
 * Sepolia. This module only builds and validates the payload; the complete
 * encode/sign/send/confirm path is the sibling `./kyc-emitter`, which reuses the
 * encoding and the approval gate defined here and refuses to broadcast unless
 * the approval record exists. Every result below is marked `sent: false`, so a
 * caller cannot mistake this prepared payload for an issued attestation.
 */

/** The `kade.kyc.v1` field values, in schema order. */
export interface KycFields {
  /** ISO 3166-1 alpha-2 (`NL`); the schema stores the two-letter code. */
  readonly nationality: string;
  readonly over18: boolean;
  readonly notSanctioned: boolean;
  /** `kade.kyc.v1.selfNullifier` is a bytes32. */
  readonly selfNullifier: Hex;
  /** Unix seconds; `kade.kyc.v1.expiresAt` is a uint64. */
  readonly expiresAt: number;
}

/** The canonical schema string and field definitions, straight from shared. */
export function kycSchemaDefinition(): {
  readonly name: EasSchemaName;
  readonly schema: string;
  readonly fields: readonly { readonly name: string; readonly type: string }[];
} {
  const definition = EAS_SCHEMAS['kade.kyc.v1'];
  return {
    name: definition.name,
    schema: encodeSchema(definition),
    fields: definition.fields.map((field) => ({
      name: field.name,
      type: field.type,
    })),
  };
}

const NATIONALITY_PATTERN = /^[A-Z]{2}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const MAX_UINT64 = 2n ** 64n - 1n;

/**
 * A value that does not fit the frozen schema is rejected rather than coerced:
 * an attestation that encodes the wrong thing cannot be walked back, and a
 * truncated or guessed field is worse than no payload.
 */
function assertKycFields(fields: KycFields): void {
  if (
    typeof fields.nationality !== 'string' ||
    !NATIONALITY_PATTERN.test(fields.nationality)
  ) {
    throw new Error(
      'kade.kyc.v1.nationality must be an ISO 3166-1 alpha-2 code (for example "NL").',
    );
  }
  if (typeof fields.over18 !== 'boolean' || typeof fields.notSanctioned !== 'boolean') {
    throw new Error(
      'kade.kyc.v1.over18 and kade.kyc.v1.notSanctioned must be booleans.',
    );
  }
  if (typeof fields.selfNullifier !== 'string' || !BYTES32_PATTERN.test(fields.selfNullifier)) {
    throw new Error('kade.kyc.v1.selfNullifier must be a 32-byte hex value.');
  }
  if (!Number.isInteger(fields.expiresAt) || fields.expiresAt < 0) {
    throw new Error('kade.kyc.v1.expiresAt must be a non-negative Unix time in seconds.');
  }
  if (BigInt(fields.expiresAt) > MAX_UINT64) {
    throw new Error('kade.kyc.v1.expiresAt does not fit its uint64 field.');
  }
}

/**
 * ABI-encode the `kade.kyc.v1` attestation data.
 *
 * Values are matched to fields by name but emitted in the schema's order, so a
 * schema reordering cannot be silently rendered incorrectly. An unknown field,
 * or a value that does not fit its type, throws rather than producing a payload
 * that would attest the wrong thing.
 */
export function encodeKycAttestationData(fields: KycFields): Hex {
  assertKycFields(fields);

  const definition = EAS_SCHEMAS['kade.kyc.v1'];
  const valuesByName: Record<string, unknown> = {
    nationality: fields.nationality,
    over18: fields.over18,
    notSanctioned: fields.notSanctioned,
    selfNullifier: fields.selfNullifier,
    expiresAt: BigInt(fields.expiresAt),
  };

  const parameters = definition.fields.map((field) => ({
    name: field.name,
    type: field.type,
  }));
  const values = definition.fields.map((field) => {
    if (!(field.name in valuesByName)) {
      throw new Error(`kade.kyc.v1 field "${field.name}" has no value to encode.`);
    }
    return valuesByName[field.name];
  });

  return encodeAbiParameters(parameters, values);
}

/**
 * The approval an irreversible identity attestation requires.
 *
 * Mirrors `PermitIssuanceGate` / `RegistrationApproval`: the gate is a single
 * `true` flag. No approver name or timestamp is recorded, so
 * `KADE_KYC_ISSUANCE_APPROVED=true` alone is sufficient.
 */
export interface KycIssuanceGate {
  readonly onchainGateApproved: boolean;
}

/** Read the issuance gate from the server environment, if recorded. */
export function readKycIssuanceGate(): KycIssuanceGate | null {
  const approved = process.env.KADE_KYC_ISSUANCE_APPROVED?.trim();
  if (!approved) return null;
  return {
    onchainGateApproved: approved === 'true',
  };
}

export function assertKycIssuanceApproved(gate: KycIssuanceGate): void {
  if (!gate.onchainGateApproved) {
    throw new Error(
      'kade.kyc.v1 issuance blocked: the Onchain gate has not been approved ' +
        '(week-2 contract section 7, checkpoint 3). Issuance is irreversible.',
    );
  }
}

/**
 * The outcome of asking for a `kade.kyc.v1` payload.
 *
 * `sent` is literally `false` on every variant: this module has no send path, so
 * no result can be read as an issued attestation. `prepared` carries the encoded
 * payload for a future submission step; it is not, and must not be treated as,
 * an on-chain attestation.
 */
export type KycIssuanceResult =
  | {
      readonly status: 'prepared';
      readonly sent: false;
      readonly payload: Hex;
      readonly reason: string;
    }
  | { readonly status: 'blocked'; readonly sent: false; readonly reason: string }
  | { readonly status: 'not-configured'; readonly sent: false; readonly reason: string };

/**
 * The preparation entry point.
 *
 * This build can only reach `not-configured`, `blocked`, or a `prepared` payload
 * that is explicitly unsent. The gate is not recorded and no broadcast path
 * exists, so nothing is ever issued; the encoding above is the part that is
 * implemented and tested, so when the gate is approved and an attester is
 * supplied, only the submission step remains.
 */
export function prepareKycAttestation(
  fields: KycFields,
  gate: KycIssuanceGate | null = readKycIssuanceGate(),
): KycIssuanceResult {
  if (gate === null) {
    return {
      status: 'not-configured',
      sent: false,
      reason:
        'No kade.kyc.v1 issuance approval is recorded in this environment, so ' +
        'no payload is prepared.',
    };
  }

  try {
    assertKycIssuanceApproved(gate);
  } catch (cause) {
    return {
      status: 'blocked',
      sent: false,
      reason:
        cause instanceof Error ? cause.message : 'kade.kyc.v1 issuance blocked.',
    };
  }

  let payload: Hex;
  try {
    payload = encodeKycAttestationData(fields);
  } catch (cause) {
    return {
      status: 'blocked',
      sent: false,
      reason:
        'kade.kyc.v1 payload could not be encoded: ' +
        (cause instanceof Error ? cause.message : 'unknown error'),
    };
  }

  return {
    status: 'prepared',
    sent: false,
    payload,
    reason:
      'The kade.kyc.v1 payload is prepared but NOT sent: this module only builds ' +
      'the payload. Issuance is the separate, approval-gated ./kyc-emitter path, ' +
      'so no attestation was issued here.',
  };
}
