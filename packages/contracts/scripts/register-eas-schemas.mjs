// EAS schema registration planner.
//
// SAFETY: this script NEVER signs or sends a transaction. It has no broadcast
// mode and rejects every argument. It produces the exact SchemaRegistry
// `register` calldata for human review and manual execution, and it refuses to
// run unless the Onchain gate approval record exists
// (docs/week-1-frozen-delivery-contract.md section 7, checkpoint 3).
import { readFileSync } from 'node:fs';
import { encodeFunctionData, encodePacked, keccak256, zeroAddress } from 'viem';
import { loadApprovalRecord } from './eas-approval.mjs';
import { MANIFEST_PATH, buildManifest, serializeManifest } from './eas-manifest.mjs';

const REGISTER_ABI = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'schema', type: 'string' },
      { name: 'resolver', type: 'address' },
      { name: 'revocable', type: 'bool' },
    ],
    outputs: [{ name: 'uid', type: 'bytes32' }],
  },
];

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

for (const schema of manifest.schemas) {
  const resolver = schema.resolver ?? zeroAddress;
  const calldata = encodeFunctionData({
    abi: REGISTER_ABI,
    functionName: 'register',
    args: [schema.schema, resolver, schema.revocable],
  });
  const predictedUid = keccak256(
    encodePacked(['string', 'address', 'bool'], [schema.schema, resolver, schema.revocable]),
  );

  console.log(`name:        ${schema.name}`);
  console.log(`schema:      ${schema.schema}`);
  console.log(`resolver:    ${resolver}`);
  console.log(`revocable:   ${schema.revocable}`);
  console.log(`attester:    ${schema.attester}`);
  console.log(`recipient:   ${schema.recipient}`);
  console.log(`predictedUid: ${predictedUid}`);
  console.log(`calldata:    ${calldata}`);
  console.log('');
}

console.log('Next steps (human, after Onchain gate approval):');
console.log('  1. Execute the calldata above from the authorised registration account.');
console.log('  2. Record each resulting UID and transaction hash in eas/registered-uids.json.');
console.log('  3. Run the verification script to compare the registry with this manifest.');
