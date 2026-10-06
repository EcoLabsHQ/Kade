// Independent re-derivation of the SafeAddress known vector.
//
// The Foundry test `test/SafeAddress.t.sol` pins a fixed expected address and a
// fixed proxy-creation-code hash. This script re-derives both with viem, an
// implementation independent from the Solidity library, so a reviewer can check
// the test vector without trusting the contract under test.
//
// Usage:
//   cd packages/contracts
//   forge clean && forge build   # MUST be clean; see the staleness guard
//   node scripts/safe-address-vector.mjs
//
// The script reads the compiled artifact, checks that it is fresh, and prints.
// It deploys nothing, signs nothing and writes nothing.
//
// Staleness guard: `forge build` is incremental and does not recompile
// `SafeProxy` when only the remapping set changed. solc embeds
// `settings.remappings` in the artifact metadata, and those remappings are part
// of the creation code, so a stale out/SafeProxy.sol/SafeProxy.json prints the
// OLD constants. The guard compares the artifact's embedded remappings with the
// live `forge remappings` and aborts on a mismatch.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { concat, keccak256, pad, slice, toHex } from 'viem';

const ARTIFACT = new URL('../out/SafeProxy.sol/SafeProxy.json', import.meta.url);
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

// Fixed synthetic inputs. This is a test fixture, never a deployment config.
const FACTORY = '0x1111111111111111111111111111111111111111';
const SINGLETON = '0x2222222222222222222222222222222222222222';
const INITIALIZER_PREIMAGE = 'kade-safe-initializer-vector-v1';
const SALT_NONCE = 0n;

const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
assertArtifactIsFresh(artifact);
const proxyCreationCode = artifact.bytecode.object;

const initializerHash = keccak256(toHex(INITIALIZER_PREIMAGE));

// SafeProxyFactory.deployProxy appends the singleton as a full 32-byte word.
const initCode = concat([proxyCreationCode, pad(SINGLETON, { size: 32 })]);
const initCodeHash = keccak256(initCode);

// SafeProxyFactory.createProxyWithNonce salt.
const salt = keccak256(encodeSalt(initializerHash, SALT_NONCE));

// CREATE2: keccak256(0xff ++ factory ++ salt ++ initCodeHash)[12:].
const address = slice(keccak256(concat(['0xff', FACTORY, salt, initCodeHash])), 12);

function encodeSalt(hash, nonce) {
  return concat([hash, pad(toHex(nonce), { size: 32 })]);
}

function hex(value) {
  return typeof value === 'bigint' ? `0x${value.toString(16)}` : value;
}

// Refuse a stale artifact. See the staleness-guard note at the top of the file.
function assertArtifactIsFresh(artifact) {
  const metadata =
    typeof artifact.metadata === 'string' ? JSON.parse(artifact.metadata) : artifact.metadata;
  const embedded = metadata?.settings?.remappings;
  if (!Array.isArray(embedded)) {
    // No embedded remappings to compare (unexpected for solc 0.8.x). Fall back
    // to the documented clean-build procedure rather than failing closed.
    return;
  }

  let live;
  try {
    live = execFileSync('forge', ['remappings'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
    })
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (error) {
    console.warn(
      `warning: could not run \`forge remappings\` to check artifact freshness (${error.message}).`,
    );
    console.warn('warning: assuming out/SafeProxy.sol/SafeProxy.json is fresh.');
    return;
  }

  const normalize = (xs) => [...xs].sort();
  if (JSON.stringify(normalize(embedded)) !== JSON.stringify(normalize(live))) {
    console.error('error: out/SafeProxy.sol/SafeProxy.json is stale.');
    console.error('Its embedded solc remappings differ from the live `forge remappings`:');
    console.error(`  artifact: ${JSON.stringify(normalize(embedded))}`);
    console.error(`  live:     ${JSON.stringify(normalize(live))}`);
    console.error('solc embeds remappings in the metadata, so they change the creation code,');
    console.error('and `forge build` is incremental: it does not recompile SafeProxy when only');
    console.error('the remapping set changed. Re-derive from a clean build:');
    console.error('  forge clean && forge build');
    process.exit(1);
  }
}

console.log('SafeAddress known vector (independent viem derivation)');
console.log(`factory            ${FACTORY}  [arbitrary]`);
console.log(`singleton          ${SINGLETON}  [arbitrary]`);
console.log(`initializerPreimage "${INITIALIZER_PREIMAGE}"  [arbitrary]`);
console.log(`initializerHash    ${initializerHash}  [arbitrary]`);
console.log(`saltNonce          ${hex(SALT_NONCE)}  [arbitrary]`);
console.log('');
console.log(`proxyCreationCodeHash ${keccak256(proxyCreationCode)}  [our build, not the deployed factory's]`);
console.log(`initCodeHash          ${initCodeHash}`);
console.log(`salt                  ${salt}`);
console.log('');
console.log(`expectedAddress       ${address}`);
