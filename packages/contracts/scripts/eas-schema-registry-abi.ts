// Read ABI for the EAS SchemaRegistry's `getSchema(bytes32)` view.
//
// `getSchema` returns one `SchemaRecord` struct, not four loose values. Declared
// flat, viem mis-decodes the trailing string and throws
// `PositionOutOfBoundsError`; that went unnoticed while no schemas were
// registered, because the read loop in verify-eas-schemas.mjs was never
// entered. The shape is kept here, apart from any script side effects, so a
// regression test can assert it without a network or a live registry.
export const SCHEMA_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'getSchema',
    stateMutability: 'view',
    inputs: [{ name: 'uid', type: 'bytes32' }],
    outputs: [
      {
        name: 'record',
        type: 'tuple',
        components: [
          { name: 'uid', type: 'bytes32' },
          { name: 'resolver', type: 'address' },
          { name: 'revocable', type: 'bool' },
          { name: 'schema', type: 'string' },
        ],
      },
    ],
  },
] as const;
