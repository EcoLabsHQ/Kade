// Shared EAS registration plan computation.
//
// The human-facing planner (register-eas-schemas.mjs) and the committed
// registration-calldata.json generator both use this module, so the
// SchemaRegistry ABI and the schema-UID formula are defined exactly once.
//
// SAFETY: pure computation. Nothing here reads a key, signs, sends or writes.
import { encodeFunctionData, encodePacked, keccak256, zeroAddress } from 'viem';

export const REGISTER_ABI = [
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

/**
 * Computes the EAS schema UID: keccak256(abi.encodePacked(schema, resolver,
 * revocable)).
 *
 * Confirmed against the exact Sepolia deployment: the verified
 * `SchemaRegistry._getUID` source (Sourcify full match of
 * 0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0) uses this formula, and a
 * read-only `eth_call` simulation of `register(...)` on that contract returns
 * these same values.
 */
export function schemaUid(schema, resolver, revocable) {
  return keccak256(encodePacked(['string', 'address', 'bool'], [schema, resolver, revocable]));
}

export function encodeRegisterCalldata(schema, resolver, revocable) {
  return encodeFunctionData({
    abi: REGISTER_ABI,
    functionName: 'register',
    args: [schema, resolver, revocable],
  });
}

/**
 * Turns the approved manifest into the exact per-schema registration plan.
 * A manifest `resolver: null` means no resolver, encoded as the zero address.
 */
export function buildRegistrationPlan(manifest) {
  return manifest.schemas.map((schema) => {
    const resolver = schema.resolver ?? zeroAddress;
    return {
      name: schema.name,
      schema: schema.schema,
      resolver,
      revocable: schema.revocable,
      targetRegistry: manifest.schemaRegistry,
      calldata: encodeRegisterCalldata(schema.schema, resolver, schema.revocable),
      expectedUid: schemaUid(schema.schema, resolver, schema.revocable),
      attester: schema.attester,
      recipient: schema.recipient,
    };
  });
}
