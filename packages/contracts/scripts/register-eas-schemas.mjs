// EAS schema registration planner.
//
// SAFETY: this script NEVER signs or sends a transaction. It has no broadcast
// mode and rejects every argument. It produces the exact SchemaRegistry
// `register` calldata for human review and manual execution, and it refuses to
// run unless the Onchain gate approval record exists
// (docs/week-1-frozen-delivery-contract.md section 7, checkpoint 3).
import { readFileSync } from 'node:fs';
import { loadApprovalRecord } from './eas-approval.mjs';
import { MANIFEST_PATH, buildManifest, serializeManifest } from './eas-manifest.mjs';
import { buildRegistrationPlan } from './eas-registration-plan.mjs';

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

console.log('EAS schema registration plan');
console.log('Registered? NO — this is a plan. Nothing is signed or sent.');
console.log(`Onchain gate approval: ${approval.approvedBy} at ${approval.approvedAt}`);
console.log(
  `Target: ${manifest.targetChainName} (chain ${manifest.targetChainId}), ` +
    `SchemaRegistry ${manifest.schemaRegistry}`,
);
console.log('');

const plan = buildRegistrationPlan(manifest);

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

console.log('Next steps (human, after Onchain gate approval):');
console.log('  1. Execute the calldata above from the authorised registration account.');
console.log('  2. Record each resulting UID and transaction hash in eas/registered-uids.json.');
console.log('  3. Run the verification script to compare the registry with this manifest.');
