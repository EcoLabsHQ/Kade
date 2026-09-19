// Independent re-derivation of the SafeAddress known vector.
//
// The Foundry test `test/SafeAddress.t.sol` pins a fixed expected address and a
// fixed proxy-creation-code hash. This script re-derives both with viem, an
// implementation independent from the Solidity library, so a reviewer can check
// the test vector without trusting the contract under test.
//
// Usage:
//   cd packages/contracts
//   forge build         # produces out/SafeProxy.sol/SafeProxy.json
//   node scripts/safe-address-vector.mjs
//
// The script only reads the compiled artifact and prints. It deploys nothing,
// signs nothing and writes nothing.
import { readFileSync } from 'node:fs';
import { concat, keccak256, pad, slice, toHex } from 'viem';

const ARTIFACT = new URL('../out/SafeProxy.sol/SafeProxy.json', import.meta.url);

// Fixed synthetic inputs. This is a test fixture, never a deployment config.
const FACTORY = '0x1111111111111111111111111111111111111111';
const SINGLETON = '0x2222222222222222222222222222222222222222';
const INITIALIZER_PREIMAGE = 'kade-safe-initializer-vector-v1';
const SALT_NONCE = 0n;

const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8'));
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
