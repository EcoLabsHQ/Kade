import { encodeAbiParameters, type Hex } from 'viem';
import { EAS_SCHEMAS, encodeSchema, type EasSchemaName } from '@kade/shared';

/**
 * The `kade.permit.v1` issuance path (D16 / EXE-012).
 *
 * A permit is issued once the residency checks are green. Issuance is an
 * irreversible on-chain EAS attestation, so this module:
 *   1. builds the attestation payload from the **frozen** shared schema
 *      (`EAS_SCHEMAS['kade.permit.v1']`); field order and types come from there,
 *      never re-typed, so the encoding cannot change without the Onchain gate;
 *   2. requires an explicit approval gate before any write;
 *   3. never broadcasts in this build.
 *
 * **BLOCKED: permit issuance gate.** The Week 2 Onchain gate (contract §7,
 * checkpoint 3) has not approved issuance, and no mainnet RPC/payer/attester is
 * supplied. `issuePermit` therefore returns `blocked` and performs no write. No
 * permit is faked.
 */

/** The `kade.permit.v1` field values, in schema order. */
export interface PermitFields {
  readonly applicationRef: string;
  readonly tier: string;
  /** Unix seconds; `kade.permit.v1.validUntil` is a uint64. */
  readonly validUntil: number;
}

/** The canonical schema string and field definitions, straight from shared. */
export function permitSchemaDefinition(): {
  readonly name: EasSchemaName;
  readonly schema: string;
  readonly fields: readonly { readonly name: string; readonly type: string }[];
} {
  const definition = EAS_SCHEMAS['kade.permit.v1'];
  return {
    name: definition.name,
    schema: encodeSchema(definition),
    fields: definition.fields.map((field) => ({
      name: field.name,
      type: field.type,
    })),
  };
}

/**
 * ABI-encode the `kade.permit.v1` attestation data.
 *
 * Values are matched to fields by name but emitted in the schema's order, so a
 * schema reordering cannot be silently rendered incorrectly. An unknown field,
 * or a value that does not fit its type, throws rather than producing a payload
 * that would attest the wrong thing.
 */
export function encodePermitAttestationData(fields: PermitFields): Hex {
  const definition = EAS_SCHEMAS['kade.permit.v1'];

  const valuesByName: Record<string, unknown> = {
    applicationRef: fields.applicationRef,
    tier: fields.tier,
    validUntil: BigInt(fields.validUntil),
  };

  const parameters = definition.fields.map((field) => ({
    name: field.name,
    type: field.type,
  }));
  const values = definition.fields.map((field) => {
    if (!(field.name in valuesByName)) {
      throw new Error(
        `kade.permit.v1 field "${field.name}" has no value to encode.`,
      );
    }
    return valuesByName[field.name];
  });

  return encodeAbiParameters(parameters, values);
}

/**
 * The approval an irreversible permit issuance requires.
 *
 * Mirrors `RegistrationApproval` in `@kade/shared/src/eas.ts`: the gate must
 * record that it was approved and by whom.
 */
export interface PermitIssuanceGate {
  readonly onchainGateApproved: boolean;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

/** Read the issuance gate from the server environment, if recorded. */
export function readPermitIssuanceGate(): PermitIssuanceGate | null {
  const approved = process.env.KADE_PERMIT_ISSUANCE_APPROVED?.trim();
  if (!approved) return null;
  return {
    onchainGateApproved: approved === 'true',
    approvedBy: process.env.KADE_PERMIT_ISSUANCE_APPROVED_BY?.trim() ?? '',
    approvedAt: process.env.KADE_PERMIT_ISSUANCE_APPROVED_AT?.trim() ?? '',
  };
}

export function assertPermitIssuanceApproved(gate: PermitIssuanceGate): void {
  if (!gate.onchainGateApproved) {
    throw new Error(
      'Permit issuance blocked: the Onchain gate has not been approved ' +
        '(week-2 contract section 7, checkpoint 3). Issuance is irreversible.',
    );
  }
  if (!gate.approvedBy || !gate.approvedAt) {
    throw new Error(
      'Permit issuance blocked: approval must record who approved it and when.',
    );
  }
}

export type PermitIssuanceResult =
  | { readonly status: 'issued'; readonly uid: string }
  | { readonly status: 'blocked'; readonly reason: string }
  | { readonly status: 'not-configured'; readonly reason: string }
  | { readonly status: 'unauthenticated' };

/**
 * The issuance entry point.
 *
 * This build can only reach `not-configured` or `blocked`: the gate is not
 * recorded and there is no broadcast path (the repository deliberately contains
 * none for EAS). The payload builder above is the part that is implemented and
 * tested, so when the gate is approved and an attester is supplied, only the
 * submission step remains.
 */
export function issuePermit(
  gate: PermitIssuanceGate | null = readPermitIssuanceGate(),
): PermitIssuanceResult {
  if (gate === null) {
    return {
      status: 'not-configured',
      reason:
        'No permit issuance approval is recorded in this environment, so no ' +
        'permit can be issued.',
    };
  }
  try {
    assertPermitIssuanceApproved(gate);
  } catch (cause) {
    return {
      status: 'blocked',
      reason: cause instanceof Error ? cause.message : 'Permit issuance blocked.',
    };
  }
  return {
    status: 'blocked',
    reason:
      'The Onchain gate is approved but no broadcast path is wired in this ' +
      'build, so the permit was not issued.',
  };
}
