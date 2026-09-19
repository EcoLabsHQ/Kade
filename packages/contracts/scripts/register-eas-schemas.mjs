// EAS schema registration planner.
//
// SAFETY: this script NEVER signs or sends a transaction. It has no broadcast
// mode and rejects every argument. It prints the exact SchemaRegistry
// `register` calldata for human review and manual execution, and it refuses to
// run unless the Onchain gate approval record exists
// (docs/week-1-frozen-delivery-contract.md section 7, checkpoint 3). Whether
// the schemas are registered is read from eas/registered-uids.json, never
// asserted by hand.
import { readFileSync } from 'node:fs';
import { loadApprovalRecord } from './eas-approval.mjs';
import { MANIFEST_PATH, buildManifest, serializeManifest } from './eas-manifest.mjs';
import { buildRegistrationPlan } from './eas-registration-plan.mjs';
import { readRegistrationRecord, registrationStatus } from './eas-registration-state.mjs';

function rejectArguments(argv) {
  const args = argv.slice(2);
  if (args.length > 0) {
    throw new Error(
      `This planner accepts no arguments and never broadcasts. Received: ${args.join(' ')}`,
    );
  }
}

rejectArguments(process.argv);
const approval = loadApprovalRecord();

const manifest = buildManifest();
let committed;
try {
  committed = readFileSync(MANIFEST_PATH, 'utf8');
} catch {
  throw new Error(`Committed manifest missing at ${MANIFEST_PATH.pathname}. Generate it first.`);
}
if (committed !== serializeManifest(manifest)) {
  throw new Error(
    'Committed manifest does not match @kade/shared. Regenerate and re-review it at the Onchain gate.',
  );
}

const plan = buildRegistrationPlan(manifest);
const status = registrationStatus(manifest.schemas, readRegistrationRecord());

console.log('EAS schema registration plan');
if (status.allRegistered) {
  console.log(
    `Registered? YES — all ${status.totalSchemas} schemas are recorded in eas/registered-uids.json.`,
  );
  console.log('This planner still never signs or sends; it prints the calldata that was executed.');
} else if (status.noneRegistered) {
  console.log('Registered? NO — this is a plan. Nothing is signed or sent.');
} else {
  console.log(
    `Registered? PARTIAL — ${status.registeredCount} of ${status.totalSchemas} schemas are recorded in eas/registered-uids.json.`,
  );
}
console.log(`Onchain gate approval: ${approval.approvedBy} at ${approval.approvedAt}`);
console.log(
  `Target: ${manifest.targetChainName} (chain ${manifest.targetChainId}), ` +
    `SchemaRegistry ${manifest.schemaRegistry}`,
);
console.log('');

for (const entry of plan) {
  console.log(`name:        ${entry.name}`);
  console.log(`schema:      ${entry.schema}`);
  console.log(`resolver:    ${entry.resolver}`);
  console.log(`revocable:   ${entry.revocable}`);
  console.log(`attester:    ${entry.attester}`);
  console.log(`recipient:   ${entry.recipient}`);
  console.log(`predictedUid: ${entry.expectedUid}`);
  console.log(`calldata:    ${entry.calldata}`);
  console.log('');
}

if (status.allRegistered) {
  console.log('Next steps (human):');
  console.log('  1. Run the verification script to compare the registry with this manifest.');
} else {
  console.log('Next steps (human, after Onchain gate approval):');
  console.log('  1. Execute the calldata above from the authorised registration account.');
  console.log('  2. Record each resulting UID and transaction hash in eas/registered-uids.json.');
  console.log('  3. Run the verification script to compare the registry with this manifest.');
}
