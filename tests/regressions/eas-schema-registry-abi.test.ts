/**
 * Regression: the EAS SchemaRegistry `getSchema` ABI shape.
 *
 * This failed before.
 *
 * The verifier declared `getSchema` as four flat outputs instead of one
 * `SchemaRecord` tuple. viem decoded the return value positionally, the trailing
 * `string` read ran past the end of the return data, and `readContract` threw
 * `PositionOutOfBoundsError`. The bug was invisible because
 * `eas/registered-uids.json` had no registrations, so the read loop in
 * `verify-eas-schemas.mjs` was never entered. Once the schemas were registered
 * the loop ran and the decode failed.
 *
 * This must continue working.
 *
 * The ABI now lives in a side-effect-free module
 * (`packages/contracts/scripts/eas-schema-registry-abi.ts`) so it can be
 * asserted without a network or a live registry. `packages/contracts` has no
 * JavaScript test runner of its own — its tests are Foundry/Solidity — so the
 * repository's regression suite is the honest place for this executable
 * evidence (AGENTS.md; docs/DEVELOPMENT_CONTRACT.md section 14).
 */
import { describe, expect, it } from 'vitest';
import { SCHEMA_REGISTRY_ABI } from '../../packages/contracts/scripts/eas-schema-registry-abi';

interface AbiComponent {
  readonly name?: string;
  readonly type: string;
  readonly components?: readonly AbiComponent[];
}

interface AbiEntry {
  readonly type: string;
  readonly name?: string;
  readonly stateMutability?: string;
  readonly inputs?: readonly AbiComponent[];
  readonly outputs?: readonly AbiComponent[];
}

const abi = SCHEMA_REGISTRY_ABI as unknown as readonly AbiEntry[];

function getSchemaEntry(): AbiEntry {
  const entry = abi.find(
    (candidate) => candidate.type === 'function' && candidate.name === 'getSchema',
  );
  expect(entry, 'getSchema must be declared as a function').toBeDefined();
  return entry as AbiEntry;
}

describe('regression: EAS SchemaRegistry getSchema ABI shape', () => {
  it('returns one SchemaRecord tuple, not four flat outputs', () => {
    const outputs = getSchemaEntry().outputs;
    expect(outputs).toHaveLength(1);
    expect(outputs?.[0]?.type).toBe('tuple');
  });

  it('declares the SchemaRecord fields in their on-chain order', () => {
    const record = getSchemaEntry().outputs?.[0];
    expect(record?.components?.map((component) => [component.name, component.type])).toEqual([
      ['uid', 'bytes32'],
      ['resolver', 'address'],
      ['revocable', 'bool'],
      ['schema', 'string'],
    ]);
  });

  it('takes a single bytes32 uid and is a view function', () => {
    const entry = getSchemaEntry();
    expect(entry.stateMutability).toBe('view');
    expect(entry.inputs?.map((input) => [input.name, input.type])).toEqual([
      ['uid', 'bytes32'],
    ]);
  });
});
