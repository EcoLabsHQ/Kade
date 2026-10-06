// The membership deployment inputs, read from configuration and validated.
//
// The required inputs — the target chain, the RPC, the deployer address and the
// Safe that will own the manager — are **not invented**. They are read from a
// committed-shape file (`membership/deployment-inputs.json`, overridable with
// `KADE_MEMBERSHIP_DEPLOYMENT_INPUTS`) and the reader fails closed when any is
// absent or malformed. The example file carries placeholders only.
//
// SAFETY: this module reads a JSON file. It never connects, signs or sends.
import { readFileSync } from 'node:fs';

export const DEFAULT_INPUTS_PATH = new URL(
  '../membership/deployment-inputs.json',
  import.meta.url,
);
export const EXAMPLE_INPUTS_PATH = new URL(
  '../membership/deployment-inputs.example.json',
  import.meta.url,
);

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function assertAddress(value, field) {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) {
    throw new Error(
      `Membership deployment input "${field}" must be a 20-byte hex address, got "${String(value)}".`,
    );
  }
  return value;
}

/** Validate a parsed inputs object; throws on the first problem. */
export function validateMembershipDeploymentInputs(inputs) {
  if (!inputs || typeof inputs !== 'object') {
    throw new Error('Membership deployment inputs must be a JSON object.');
  }
  if (!Number.isInteger(inputs.chainId) || inputs.chainId <= 0) {
    throw new Error('Membership deployment input "chainId" must be a positive integer.');
  }
  if (typeof inputs.chainName !== 'string' || inputs.chainName.trim() === '') {
    throw new Error('Membership deployment input "chainName" is required.');
  }
  if (typeof inputs.rpcUrl !== 'string' || inputs.rpcUrl.trim() === '') {
    throw new Error('Membership deployment input "rpcUrl" is required.');
  }
  try {
    // A URL parse only: the plan never dials it.
    new URL(inputs.rpcUrl);
  } catch {
    throw new Error('Membership deployment input "rpcUrl" must be a valid URL.');
  }
  assertAddress(inputs.deployer, 'deployer');
  assertAddress(inputs.safe, 'safe');
  if (inputs.deployerNonce !== undefined && inputs.deployerNonce !== null) {
    if (!Number.isInteger(inputs.deployerNonce) || inputs.deployerNonce < 0) {
      throw new Error(
        'Membership deployment input "deployerNonce", when present, must be a non-negative integer.',
      );
    }
  }
  return inputs;
}

/**
 * Read the inputs, returning `null` when the file is absent or is not JSON.
 * Generators that merely describe the gate state use this.
 */
export function readMembershipDeploymentInputs(
  inputsPath = process.env.KADE_MEMBERSHIP_DEPLOYMENT_INPUTS ?? DEFAULT_INPUTS_PATH,
) {
  let raw;
  try {
    raw = readFileSync(inputsPath, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Load and validate the inputs, failing closed when they are absent or invalid.
 * The generator uses this so it can never produce a plan from a partial config.
 */
export function loadMembershipDeploymentInputs(
  inputsPath = process.env.KADE_MEMBERSHIP_DEPLOYMENT_INPUTS ?? DEFAULT_INPUTS_PATH,
) {
  let raw;
  try {
    raw = readFileSync(inputsPath, 'utf8');
  } catch {
    throw new Error(
      `Membership deployment inputs not found at ${String(inputsPath)}. ` +
        'Copy membership/deployment-inputs.example.json and fill in the target chain, ' +
        'RPC, deployer address and the Safe that will own the manager. No value is invented.',
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Membership deployment inputs at ${String(inputsPath)} are not valid JSON.`);
  }
  return validateMembershipDeploymentInputs(parsed);
}
