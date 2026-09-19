// Emits eas/registration-calldata.json: the exact SchemaRegistry.register
// calldata for the five approved Kade EAS schemas, together with the current
// registration state read from eas/registered-uids.json.
//
// SAFETY: no network access, no signing, no broadcast, and no private key is
// read or written. The project owner signs and sends each transaction from
// their own funded Sepolia account. This script only writes the calldata
// record. It never asserts by hand whether registration happened: the state is
// derived from the committed record.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadApprovalRecord } from './eas-approval.mjs';
import { MANIFEST_PATH, buildManifest, serializeManifest } from './eas-manifest.mjs';
import { buildRegistrationPlan } from './eas-registration-plan.mjs';
import {
  REGISTRATIONS_PATH,
  readRegistrationRecord,
  registeredUids,
  registrationStatus,
} from './eas-registration-state.mjs';

export const CALLDATA_PATH = new URL('../eas/registration-calldata.json', import.meta.url);

function calldataComment(status) {
  const base =
    'Exact SchemaRegistry.register calldata for the five Kade EAS schemas on Ethereum Sepolia. ' +
    'The attester and recipient rules recorded in the Onchain gate review pack are off-chain and are ' +
    'NOT part of register(...).';
  if (status.allRegistered) {
    return (
      `EXECUTED — NOT A PENDING PLAN. ${base} All ${status.totalSchemas} calls were signed and sent ` +
      'by the project owner from their own funded Sepolia account; the resulting UIDs and transactions ' +
      'are recorded in eas/registered-uids.json. No EAS script in this repository has a broadcast ' +
      'mode; this file preserves the committed calldata.'
    );
  }
  if (status.noneRegistered) {
    return (
      `PLAN ONLY — NO TRANSACTION HAS BEEN SENT. ${base} The project owner signs and broadcasts each ` +
      'call from their own funded Sepolia account; no EAS script in this repository has a broadcast mode.'
    );
  }
  return (
    `PARTIALLY EXECUTED — ${status.registeredCount} of ${status.totalSchemas} calls have a recorded ` +
    `registration; the rest do not. ${base} See eas/registered-uids.json.`
  );
}

const approval = loadApprovalRecord();
const manifest = buildManifest();

let committed;
try {
  committed = readFileSync(MANIFEST_PATH, 'utf8');
} catch {
  throw new Error(`Committed manifest missing at ${MANIFEST_PATH.pathname}. Generate it first.`);
}
if (committed !== serializeManifest(manifest)) {
  throw new Error('Committed manifest does not match @kade/shared. Regenerate and re-review it.');
}

const plan = buildRegistrationPlan(manifest);
const status = registrationStatus(manifest.schemas, readRegistrationRecord());

for (const entry of plan) {
  const recorded = status.byName.get(entry.name);
  if (
    recorded?.uid &&
    recorded.uid.toLowerCase() !== entry.expectedUid.toLowerCase()
  ) {
    throw new Error(
      `Recorded UID for ${entry.name} (${recorded.uid}) does not match the calldata UID (${entry.expectedUid}).`,
    );
  }
}

const document = {
  $comment: calldataComment(status),
  targetChainId: manifest.targetChainId,
  targetChainName: manifest.targetChainName,
  schemaRegistry: manifest.schemaRegistry,
  schemaRegistryProvenance: [
    'EAS official deployments (ethereum-attestation-service/eas-contracts README): Sepolia version 0.26 SchemaRegistry is 0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0.',
    'On-chain confirmation on chain 11155111 (read-only eth_call): EAS core 0xC2679fBD37d54388Ce493F1DB75320D236e1815e getSchemaRegistry() returned 0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0.',
  ],
  uidFormula: 'keccak256(abi.encodePacked(schema, resolver, revocable))',
  uidFormulaProvenance: [
    'Deployed Sepolia SchemaRegistry source, SchemaRegistry._getUID (Sourcify full match of the runtime bytecode; runtimeMatch=matched, verified 2024-08-08).',
    'Cross-checked by read-only eth_call simulation of register(string,address,bool) on the deployed registry; the UIDs it returned equal the expectedUid values below.',
  ],
  approval: {
    onchainGateApproved: approval.onchainGateApproved,
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt,
  },
  registration: {
    registered: status.allRegistered,
    registeredCount: status.registeredCount,
    totalSchemas: status.totalSchemas,
    chainId: status.chainId,
    registrar: status.registrar,
    uids: registeredUids(status),
  },
  registrations: plan.map((entry) => ({
    name: entry.name,
    schema: entry.schema,
    resolver: entry.resolver,
    revocable: entry.revocable,
    targetRegistry: entry.targetRegistry,
    calldata: entry.calldata,
    expectedUid: entry.expectedUid,
  })),
};

writeFileSync(CALLDATA_PATH, `${JSON.stringify(document, null, 2)}\n`);

console.log(`Wrote ${CALLDATA_PATH.pathname}`);
console.log(`Schemas (${plan.length}): ${plan.map((entry) => entry.name).join(', ')}`);
if (status.allRegistered) {
  console.log(
    `All ${status.totalSchemas} schemas are recorded as registered in ${REGISTRATIONS_PATH.pathname}.`,
  );
  console.log('This script sent nothing.');
} else if (status.noneRegistered) {
  console.log('No transaction has been sent.');
} else {
  console.log(
    `${status.registeredCount} of ${status.totalSchemas} schemas have recorded registrations.`,
  );
}
