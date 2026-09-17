// SafeDeploymentManifest shape checks (Week 1 contract D4).
//
// D4 requires a persisted record of the resident Safe: deployment tx, Safe
// address, predicted L2 addresses, Safe version, factory, singleton,
// initializer, handler, owner, threshold, salt and creation-code assumptions.
// `safe/SafeDeploymentManifest.schema.json` is the shape; this module validates
// a manifest against that shape and describes every field, its provenance and
// the gate that must confirm it.
//
// Read-only: it validates JSON and prints. It deploys nothing and writes nothing.
import { readFileSync } from 'node:fs';

export const SCHEMA_PATH = new URL('../safe/SafeDeploymentManifest.schema.json', import.meta.url);
export const EXAMPLE_PATH = new URL(
  '../safe/safe-deployment-manifest.example.json',
  import.meta.url,
);

// The D4-required fields, with the gate that confirms each concrete value.
export const SAFE_DEPLOYMENT_MANIFEST_FIELDS = [
  { field: 'deploymentTxHash', gate: 'Account gate', provenance: 'arbitrary until deployed' },
  { field: 'deploymentChainId', gate: 'frozen', provenance: 'documented' },
  { field: 'safeAddress', gate: 'Account gate', provenance: 'arbitrary' },
  { field: 'predictedL2Addresses', gate: 'Account gate', provenance: 'arbitrary' },
  { field: 'safeVersion', gate: 'Account gate', provenance: 'arbitrary' },
  { field: 'factory', gate: 'Account gate', provenance: 'arbitrary' },
  { field: 'singleton', gate: 'Account gate', provenance: 'arbitrary' },
  { field: 'initializer', gate: 'Account gate', provenance: 'arbitrary' },
  { field: 'handler', gate: 'Account gate', provenance: 'arbitrary' },
  { field: 'owner', gate: 'Account gate', provenance: 'arbitrary' },
  { field: 'threshold', gate: 'frozen', provenance: 'documented' },
  { field: 'salt', gate: 'Account gate', provenance: 'arbitrary' },
  { field: 'creationCodeAssumptions', gate: 'Account gate', provenance: 'arbitrary' },
  { field: 'provenance', gate: 'Account gate', provenance: 'unapproved' },
];

function matchesType(value, expected) {
  switch (expected) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return false;
  }
}

// Minimal, dependency-free JSON Schema subset: exactly the keywords used by
// SafeDeploymentManifest.schema.json.
export function validateAgainstSchema(schema, value, path = '$') {
  const errors = [];

  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if (schema.enum && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    errors.push(`${path}: expected type ${types.join('|')}, got ${Array.isArray(value) ? 'array' : typeof value}`);
    return errors;
  }
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} does not match ${schema.pattern}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: expected at least ${schema.minItems} items, got ${value.length}`);
    }
    if (schema.items) {
      value.forEach((item, index) => {
        errors.push(...validateAgainstSchema(schema.items, item, `${path}[${index}]`));
      });
    }
  }
  if (matchesType(value, 'object')) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}: missing required field "${key}"`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) {
        errors.push(...validateAgainstSchema(child, value[key], `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(value)) {
        if (!(key in schema.properties)) errors.push(`${path}: unexpected field "${key}"`);
      }
    }
  }
  return errors;
}

export function loadSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
}

export function loadExample() {
  return JSON.parse(readFileSync(EXAMPLE_PATH, 'utf8'));
}

export function validateSafeDeploymentManifest(manifest, schema = loadSchema()) {
  return validateAgainstSchema(schema, manifest);
}

function main() {
  const example = loadExample();
  const errors = validateSafeDeploymentManifest(example);

  console.log('SafeDeploymentManifest shape (D4)');
  console.log(`Schema: ${SCHEMA_PATH.pathname}`);
  console.log(`Example: ${EXAMPLE_PATH.pathname}`);
  console.log('');
  for (const { field, provenance, gate } of SAFE_DEPLOYMENT_MANIFEST_FIELDS) {
    console.log(`${field.padEnd(26)} ${provenance.padEnd(24)} ${gate}`);
  }
  console.log('');
  if (errors.length > 0) {
    console.error(`Example does NOT conform (${errors.length} error(s)):`);
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log('Example conforms to the schema. Nothing is deployed; all values are [arbitrary].');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
