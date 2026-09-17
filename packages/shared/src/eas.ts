/**
 * EAS schema definitions — proposal only.
 *
 * Sources:
 *   - docs/week-1-frozen-delivery-contract.md section 2, item 8: the five
 *     schema names are frozen.
 *   - docs/week-1-frozen-delivery-contract.md section 4 (D6): fields come from
 *     the DOCX; encodings, revocability, resolver, attester rules and
 *     recipients must be reviewed before registration; any field absent from
 *     the DOCX is an [arbitrary] demo value flagged as such.
 *   - docs/planning/kade-mvp-build-document-v7.docx section 8 (Attestations,
 *     Identity) and section 9 (`identity_attestations`, `applications`).
 *
 * NOTHING IN THIS FILE IS REGISTERED. Registration is irreversible and is
 * blocked behind the Onchain gate (contract section 7, checkpoint 3).
 */

import type { Provenance } from './provenance.js';

/** Frozen by contract section 2, item 8. */
export const EAS_SCHEMA_NAMES = [
  'kade.kyc.v1',
  'kade.fee.v1',
  'kade.application.v1',
  'kade.review.v1',
  'kade.permit.v1',
] as const;

export type EasSchemaName = (typeof EAS_SCHEMA_NAMES)[number];

/** Solidity ABI type accepted by the EAS schema registry. */
export type SolidityType =
  | 'bool'
  | 'string'
  | 'bytes32'
  | 'uint64'
  | 'uint256'
  | 'address';

export interface EasSchemaField {
  readonly name: string;
  readonly type: SolidityType;
  readonly provenance: Provenance;
}

export interface EasSchemaDefinition {
  readonly name: EasSchemaName;
  readonly fields: readonly EasSchemaField[];
  /** Frozen by the Onchain gate before registration. */
  readonly revocable: boolean;
  readonly revocableProvenance: Provenance;
  /** `null` means no resolver; the schema is written directly. */
  readonly resolver: `0x${string}` | null;
  readonly resolverProvenance: Provenance;
  /** Who may attest against this schema. */
  readonly attester: 'kade-authorized' | 'any';
  readonly attesterProvenance: Provenance;
  /** Recipient of the attestation. */
  readonly recipient: 'resident-safe' | 'treasury-safe' | 'schema-registry';
  readonly recipientProvenance: Provenance;
}

/**
 * Encodes a definition into the canonical EAS schema string, for example
 * `string nationality,bool over18`. Field order is significant: it determines
 * the registered schema UID.
 */
export function encodeSchema(definition: EasSchemaDefinition): string {
  return definition.fields.map((f) => `${f.type} ${f.name}`).join(',');
}

/**
 * Field names are [documented]; Solidity types are [arbitrary] because the
 * build guide names the disclosed values but not their encodings.
 */
function field(name: string, type: SolidityType): EasSchemaField {
  return { name, type, provenance: 'arbitrary' };
}

export const EAS_SCHEMAS: Readonly<Record<EasSchemaName, EasSchemaDefinition>> = {
  'kade.kyc.v1': {
    name: 'kade.kyc.v1',
    fields: [
      field('nationality', 'string'),
      field('over18', 'bool'),
      field('notSanctioned', 'bool'),
      field('selfNullifier', 'bytes32'),
      field('expiresAt', 'uint64'),
    ],
    revocable: true,
    revocableProvenance: 'arbitrary',
    resolver: null,
    resolverProvenance: 'arbitrary',
    attester: 'kade-authorized',
    attesterProvenance: 'arbitrary',
    recipient: 'resident-safe',
    recipientProvenance: 'documented',
  },
  'kade.fee.v1': {
    name: 'kade.fee.v1',
    fields: [
      field('applicationRef', 'string'),
      field('amountUSDC', 'uint256'),
      field('txHash', 'bytes32'),
      field('feeType', 'string'),
    ],
    revocable: false,
    revocableProvenance: 'arbitrary',
    resolver: null,
    resolverProvenance: 'arbitrary',
    attester: 'kade-authorized',
    attesterProvenance: 'arbitrary',
    recipient: 'treasury-safe',
    recipientProvenance: 'documented',
  },
  'kade.application.v1': {
    name: 'kade.application.v1',
    fields: [
      field('applicationRef', 'string'),
      field('tier', 'string'),
      field('docsRoot', 'bytes32'),
      field('qualifyingBalance', 'uint256'),
    ],
    revocable: true,
    revocableProvenance: 'arbitrary',
    resolver: null,
    resolverProvenance: 'arbitrary',
    attester: 'kade-authorized',
    attesterProvenance: 'arbitrary',
    recipient: 'resident-safe',
    recipientProvenance: 'documented',
  },
  'kade.review.v1': {
    name: 'kade.review.v1',
    fields: [
      field('applicationRef', 'string'),
      field('cleared', 'bool'),
      field('note', 'string'),
    ],
    revocable: true,
    revocableProvenance: 'arbitrary',
    resolver: null,
    resolverProvenance: 'arbitrary',
    attester: 'kade-authorized',
    attesterProvenance: 'arbitrary',
    recipient: 'resident-safe',
    recipientProvenance: 'documented',
  },
  'kade.permit.v1': {
    name: 'kade.permit.v1',
    fields: [
      field('applicationRef', 'string'),
      field('tier', 'string'),
      field('validUntil', 'uint64'),
    ],
    revocable: true,
    revocableProvenance: 'arbitrary',
    resolver: null,
    resolverProvenance: 'arbitrary',
    attester: 'kade-authorized',
    attesterProvenance: 'arbitrary',
    recipient: 'resident-safe',
    recipientProvenance: 'documented',
  },
};

/**
 * The registration manifest: exactly what the Onchain gate must approve before
 * any irreversible write.
 */
export function registrationManifest(): readonly {
  name: EasSchemaName;
  schema: string;
  revocable: boolean;
  resolver: `0x${string}` | null;
  attester: string;
  recipient: string;
}[] {
  return EAS_SCHEMA_NAMES.map((name) => {
    const def = EAS_SCHEMAS[name];
    return {
      name,
      schema: encodeSchema(def),
      revocable: def.revocable,
      resolver: def.resolver,
      attester: def.attester,
      recipient: def.recipient,
    };
  });
}

/**
 * Registration is irreversible. These are the Week 1 constraints the caller
 * must satisfy; the guard exists so registration cannot be triggered
 * accidentally from a test or a script run.
 */
export interface RegistrationApproval {
  readonly onchainGateApproved: boolean;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

export function assertRegistrationApproved(approval: RegistrationApproval): void {
  if (!approval.onchainGateApproved) {
    throw new Error(
      'EAS registration blocked: the Onchain gate has not been approved ' +
        '(week-1 contract section 7, checkpoint 3). Registration is irreversible.',
    );
  }
  if (!approval.approvedBy || !approval.approvedAt) {
    throw new Error('EAS registration blocked: approval must record who approved it and when.');
  }
}
