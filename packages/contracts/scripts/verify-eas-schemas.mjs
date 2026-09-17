// EAS schema verification.
//
// Read-only. It recomputes the manifest from @kade/shared, checks the committed
// manifest has not drifted, then reads the SchemaRegistry with eth_call and
// compares the on-chain schema string, resolver and revocability with the
// manifest (week-1 contract section 4, D6).
//
// It never signs, sends, or writes anything, and it refuses to run unless the
// Onchain gate approval record exists.
import { readFileSync } from 'node:fs';
import { createPublicClient, http, zeroAddress } from 'viem';
import { loadApprovalRecord } from './eas-approval.mjs';
import { MANIFEST_PATH, buildManifest, loadRegistrations, serializeManifest } from './eas-manifest.mjs';

const SCHEMA_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getSchema',
    stateMutability: 'view',
    inputs: [{ name: 'uid', type: 'bytes32' }],
    outputs: [
      { name: 'uid', type: 'bytes32' },
      { name: 'resolver', type: 'address' },
      { name: 'revocable', type: 'bool' },
      { name: 'schema', type: 'string' },
    ],
  },
];

function rejectArguments(argv) {
  const args = argv.slice(2);
  if (args.length > 0) {
    throw new Error(`This verifier accepts no arguments and never broadcasts. Received: ${args.join(' ')}`);
  }
}

rejectArguments(process.argv);
const approval = loadApprovalRecord();

const manifest = buildManifest();
let committed;
try {
  committed = readFileSync(MANIFEST_PATH, 'utf8');
} catch {
  throw new Error(`Committed manifest missing at ${MANIFEST_PATH.pathname}.`);
}
if (committed !== serializeManifest(manifest)) {
  throw new Error('Committed manifest does not match @kade/shared. Regenerate and re-review it.');
}

const { registrations } = loadRegistrations();

console.log('EAS schema verification (read-only)');
console.log(`Onchain gate approval: ${approval.approvedBy} at ${approval.approvedAt}`);
console.log(`Manifest matches @kade/shared: yes (${manifest.schemas.length} schemas)`);
console.log(`Target chain: ${manifest.targetChainName} (chain ${manifest.targetChainId})`);

if (registrations.length === 0) {
  console.log('Registry has no recorded registrations (Week 1: schemas are NOT registered).');
  console.log('Nothing to compare. No writes were performed.');
  process.exit(0);
}

const rpcUrl = process.env.SEPOLIA_RPC_URL;
if (!rpcUrl) {
  throw new Error('SEPOLIA_RPC_URL is required to read the SchemaRegistry.');
}

const client = createPublicClient({ transport: http(rpcUrl) });
let mismatches = 0;

for (const registration of registrations) {
  if (registration.chainId !== manifest.targetChainId) {
    mismatches += 1;
    console.log(`FAIL ${registration.name}: chain ${registration.chainId} != ${manifest.targetChainId}`);
    continue;
  }

  const expected = manifest.schemas.find((schema) => schema.name === registration.name);
  if (!expected) {
    mismatches += 1;
    console.log(`FAIL ${registration.name}: not present in the manifest`);
    continue;
  }

  const result = await client.readContract({
    address: manifest.schemaRegistry,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: 'getSchema',
    args: [registration.uid],
  });
  const observed = Array.isArray(result)
    ? { resolver: result[1], revocable: result[2], schema: result[3] }
    : { resolver: result.resolver, revocable: result.revocable, schema: result.schema };

  const expectedResolver = (expected.resolver ?? zeroAddress).toLowerCase();
  const schemaMatches = observed.schema === expected.schema;
  const revocableMatches = observed.revocable === expected.revocable;
  const resolverMatches = observed.resolver.toLowerCase() === expectedResolver;

  if (schemaMatches && revocableMatches && resolverMatches) {
    console.log(`OK   ${registration.name} ${registration.uid}`);
  } else {
    mismatches += 1;
    console.log(`FAIL ${registration.name} ${registration.uid}`);
    if (!schemaMatches) {
      console.log(`     schema    expected=${expected.schema} observed=${observed.schema}`);
    }
    if (!revocableMatches) {
      console.log(`     revocable expected=${expected.revocable} observed=${observed.revocable}`);
    }
    if (!resolverMatches) {
      console.log(`     resolver  expected=${expectedResolver} observed=${observed.resolver}`);
    }
  }
}

if (mismatches > 0) {
  console.error(`${mismatches} mismatch(es) between the registry and the manifest.`);
  process.exit(1);
}
console.log('All recorded registrations match the manifest. No writes were performed.');
