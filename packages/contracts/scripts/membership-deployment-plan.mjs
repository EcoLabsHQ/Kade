// The Colosseum membership deployment plan — pure computation.
//
// Produces a reviewable plan for the three contracts: the deploy order, each
// constructor's arguments, the predicted CREATE addresses (when the deployer
// nonce is known) and the exact deployment calldata, followed by the owner
// Safe's one-time `setCollections(resident, citizen)` call.
//
// SAFETY: no network access, no signing, no broadcast, and no private key is
// read or written. Every result is `sent: false`. The owner deploys from their
// own funded account and executes the Safe call; no script in this repository
// has a broadcast mode.
import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  getContractAddress,
  keccak256,
} from 'viem';

/**
 * The deploy order. The manager is deployed first with the Safe as its
 * `initialOwner`; the two collections are deployed with the manager as their
 * only minter/burner; the Safe then wires them with `setCollections`.
 */
export const MEMBERSHIP_DEPLOY_ORDER = [
  'MembershipManager',
  'ColosseumResident',
  'ColosseumCitizen',
];

/** The manager's one-time wiring function. */
export const SET_COLLECTIONS_ABI = [
  {
    type: 'function',
    name: 'setCollections',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'resident_', type: 'address' },
      { name: 'citizen_', type: 'address' },
    ],
    outputs: [],
  },
];

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function assertAddress(value, field) {
  if (typeof value !== 'string' || !ADDRESS_PATTERN.test(value)) {
    throw new Error(`${field} must be a 20-byte hex address, got "${String(value)}".`);
  }
  return getAddress(value);
}

/** `creationCode ++ abi.encode(<one address>)`. */
function deploymentCalldata(creationCode, argument) {
  const encoded = encodeAbiParameters([{ type: 'address' }], [argument]);
  return `${creationCode}${encoded.slice(2)}`;
}

/** Predict the CREATE address for the nth deployment from `deployer`. */
function predictAddress(deployer, nonce) {
  return getContractAddress({ from: deployer, nonce: BigInt(nonce) });
}

/**
 * Build the complete plan.
 *
 * @param {object} input
 * @param {number} input.chainId
 * @param {string} input.chainName
 * @param {string} input.rpcUrl            recorded by host only; never dialled
 * @param {string} input.deployer
 * @param {string} input.safe
 * @param {number|null} [input.deployerNonce]  enables the address prediction
 * @param {Record<string, {creationCode: string}>} input.artifacts
 */
export function buildMembershipDeploymentPlan(input) {
  if (!Number.isInteger(input.chainId) || input.chainId <= 0) {
    throw new Error(`chainId must be a positive integer, got "${input.chainId}".`);
  }
  if (typeof input.chainName !== 'string' || input.chainName.trim() === '') {
    throw new Error('chainName is required.');
  }
  if (typeof input.rpcUrl !== 'string' || input.rpcUrl.trim() === '') {
    throw new Error('rpcUrl is required.');
  }
  let rpcHost;
  try {
    rpcHost = new URL(input.rpcUrl).host;
  } catch {
    throw new Error('rpcUrl must be a valid URL.');
  }
  const deployer = assertAddress(input.deployer, 'deployer');
  const safe = assertAddress(input.safe, 'safe');

  const artifacts = input.artifacts ?? {};
  for (const name of MEMBERSHIP_DEPLOY_ORDER) {
    const creationCode = artifacts[name]?.creationCode;
    if (typeof creationCode !== 'string' || !/^0x[0-9a-fA-F]+$/.test(creationCode)) {
      throw new Error(
        `The ${name} creation code is missing or malformed; run forge build first.`,
      );
    }
  }

  const nonce = Number.isInteger(input.deployerNonce) ? input.deployerNonce : null;
  const managerAddress = nonce === null ? null : predictAddress(deployer, nonce);
  const residentAddress = nonce === null ? null : predictAddress(deployer, nonce + 1);
  const citizenAddress = nonce === null ? null : predictAddress(deployer, nonce + 2);

  const stages = [
    {
      order: 1,
      contract: 'MembershipManager',
      constructorArgs: [{ name: 'initialOwner', value: safe }],
      creationCodeHash: keccak256(artifacts.MembershipManager.creationCode),
      predictedAddress: managerAddress,
      calldata: deploymentCalldata(artifacts.MembershipManager.creationCode, safe),
      dependsOn: null,
      note: 'The Safe is the Ownable2Step owner; no administrative permission stays with the deployer.',
    },
    {
      order: 2,
      contract: 'ColosseumResident',
      constructorArgs: [{ name: 'manager_', value: managerAddress }],
      creationCodeHash: keccak256(artifacts.ColosseumResident.creationCode),
      predictedAddress: residentAddress,
      calldata:
        managerAddress === null
          ? null
          : deploymentCalldata(artifacts.ColosseumResident.creationCode, managerAddress),
      dependsOn: managerAddress === null ? 'MembershipManager' : null,
      note: 'The manager is the only minter/burner.',
    },
    {
      order: 3,
      contract: 'ColosseumCitizen',
      constructorArgs: [{ name: 'manager_', value: managerAddress }],
      creationCodeHash: keccak256(artifacts.ColosseumCitizen.creationCode),
      predictedAddress: citizenAddress,
      calldata:
        managerAddress === null
          ? null
          : deploymentCalldata(artifacts.ColosseumCitizen.creationCode, managerAddress),
      dependsOn: managerAddress === null ? 'MembershipManager' : null,
      note: 'The manager is the only minter/burner.',
    },
  ];

  const collectionsReady = managerAddress !== null && residentAddress !== null && citizenAddress !== null;
  const wiringStage = {
    order: 4,
    contract: 'MembershipManager',
    function: 'setCollections',
    caller: safe,
    args: [
      { name: 'resident_', value: residentAddress },
      { name: 'citizen_', value: citizenAddress },
    ],
    predictedTarget: managerAddress,
    calldata: collectionsReady
      ? encodeFunctionData({
          abi: SET_COLLECTIONS_ABI,
          functionName: 'setCollections',
          args: [residentAddress, citizenAddress],
        })
      : null,
    dependsOn: collectionsReady ? null : 'ColosseumResident,ColosseumCitizen',
    note: 'Executed by the Safe. One-time: setCollections reverts on a second call.',
  };

  return {
    sent: false,
    target: {
      chainId: input.chainId,
      chainName: input.chainName,
      // The RPC is a required input but is never dialled by this plan; only its
      // host is recorded so a committed plan cannot leak an endpoint key.
      rpcHost,
    },
    deployer,
    safe,
    deployerNonce: nonce,
    addressPrediction: nonce === null ? 'unavailable' : 'create',
    deployOrder: MEMBERSHIP_DEPLOY_ORDER,
    stages,
    wiringStage,
    notes: [
      'This is a PLAN. Nothing has been deployed, signed or broadcast.',
      'Deploy order: manager (owner = Safe) -> Resident/Citizen (manager as minter) -> the Safe calls setCollections(resident, citizen).',
      'Arbitrum is marked active: false in packages/shared/src/chains.ts. Re-enabling it is an explicit human decision and is not done by this plan.',
    ],
  };
}
