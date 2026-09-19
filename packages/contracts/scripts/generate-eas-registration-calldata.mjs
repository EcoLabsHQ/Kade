// Emits eas/registration-calldata.json: the exact, ready-to-send
// SchemaRegistry.register calldata for the five approved Kade EAS schemas.
//
// SAFETY: no network access, no signing, no broadcast, and no private key is
// read or written. The project owner signs and sends each transaction from
// their own funded Sepolia account. This script only writes a plan file.
import { readFileSync, writeFileSync } from 'node:fs';
import { loadApprovalRecord } from './eas-approval.mjs';
import { MANIFEST_PATH, buildManifest, serializeManifest } from './eas-manifest.mjs';
import { buildRegistrationPlan } from './eas-registration-plan.mjs';

export const CALLDATA_PATH = new URL('../eas/registration-calldata.json', import.meta.url);

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

const document = {
  $comment:
    'PLAN ONLY — NO TRANSACTION HAS BEEN SENT. Exact SchemaRegistry.register calldata for the five ' +
    'Kade EAS schemas on Ethereum Sepolia. The project owner signs and broadcasts each call from ' +
    'their own funded Sepolia account; no script in this repository has a broadcast mode. The ' +
    'attester and recipient rules recorded in the Onchain gate review pack are off-chain and are ' +
    'NOT part of register(...).',
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
console.log('No transaction has been sent.');
