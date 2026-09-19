// Builds the EAS registration manifest from @kade/shared.
//
// The manifest is the artifact the Onchain gate reviews before any
// irreversible registration. It is generated, never hand-copied, so the
// encoded schema strings cannot drift from the shared definitions
// (week-1 contract section 4, D6).
import { readFileSync } from 'node:fs';
import {
  CHAIN_IDS,
  EAS_SCHEMAS,
  EAS_SCHEMA_NAMES,
  chainByChainId,
  registrationManifest,
} from '@kade/shared';
import { readApprovalRecordOrNull } from './eas-approval.mjs';
import {
  REGISTRATIONS_PATH,
  readRegistrationRecord,
  registeredUids,
  registrationStatus,
} from './eas-registration-state.mjs';

export const MANIFEST_PATH = new URL('../eas/eas-schema-manifest.json', import.meta.url);
export const REVIEW_PATH = new URL('../eas/REVIEW.md', import.meta.url);
export { REGISTRATIONS_PATH };

export const TARGET_CHAIN_ID = CHAIN_IDS.sepolia;

function targetChain() {
  const chain = chainByChainId(TARGET_CHAIN_ID);
  if (!chain) {
    throw new Error(`No chain configuration for chain id ${TARGET_CHAIN_ID}.`);
  }
  return chain;
}

function approvalPhrase(approval) {
  if (approval?.onchainGateApproved) {
    const by = approval.approvedBy ? ` by ${approval.approvedBy}` : '';
    const at = approval.approvedAt ? ` on ${approval.approvedAt}` : '';
    return `Approved at the Onchain gate${by}${at}.`;
  }
  return 'Not approved at the Onchain gate.';
}

function manifestComment(approval, status, chain) {
  const approvalSentence = approvalPhrase(approval);
  if (status.allRegistered) {
    return (
      `${approvalSentence} Generated from @kade/shared. ` +
      `All ${status.totalSchemas} schemas are registered on ${chain.name} (chain ${chain.chainId}); ` +
      'the registrar, UIDs, transaction hashes and block numbers are recorded in ' +
      'registered-uids.json. This file describes the registered encodings; the EAS ' +
      'tooling in this repository has no broadcast mode and did not send the transactions.'
    );
  }
  if (status.noneRegistered) {
    return (
      `${approvalSentence} Generated from @kade/shared. ` +
      'Nothing here is registered; registration is irreversible and the EAS ' +
      'tooling in this repository broadcasts nothing.'
    );
  }
  return (
    `${approvalSentence} Generated from @kade/shared. ` +
    `${status.registeredCount} of ${status.totalSchemas} schemas are registered on ` +
    `${chain.name} (chain ${chain.chainId}); the rest are not. See registered-uids.json.`
  );
}

export function buildManifest() {
  const chain = targetChain();
  const indexed = new Map(registrationManifest().map((entry) => [entry.name, entry]));

  const schemas = EAS_SCHEMA_NAMES.map((name) => {
    const entry = indexed.get(name);
    const definition = EAS_SCHEMAS[name];
    if (!entry || !definition) {
      throw new Error(`Schema ${name} is missing from @kade/shared.`);
    }
    return {
      name: entry.name,
      schema: entry.schema,
      revocable: entry.revocable,
      resolver: entry.resolver,
      attester: entry.attester,
      recipient: entry.recipient,
      fields: definition.fields.map((field) => ({
        name: field.name,
        type: field.type,
        provenance: field.provenance,
      })),
      provenance: {
        revocable: definition.revocableProvenance,
        resolver: definition.resolverProvenance,
        attester: definition.attesterProvenance,
        recipient: definition.recipientProvenance,
      },
    };
  });

  const approval = readApprovalRecordOrNull();
  const status = registrationStatus(schemas, readRegistrationRecord());

  return {
    $comment: manifestComment(approval, status, chain),
    source: '@kade/shared registrationManifest()',
    targetChainId: chain.chainId,
    targetChainName: chain.name,
    schemaRegistry: chain.schemaRegistryAddress.value,
    registration: {
      registered: status.allRegistered,
      registeredCount: status.registeredCount,
      totalSchemas: status.totalSchemas,
      chainId: status.chainId,
      registrar: status.registrar,
      uids: registeredUids(status),
    },
    schemas,
  };
}

export function serializeManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function loadRegistrations(registrationsPath = REGISTRATIONS_PATH) {
  let raw;
  try {
    raw = readFileSync(registrationsPath, 'utf8');
  } catch {
    throw new Error(`Registered-UID file not found at ${String(registrationsPath)}.`);
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.registrations)) {
    throw new Error(`Registered-UID file at ${String(registrationsPath)} has no "registrations" array.`);
  }
  return parsed;
}
