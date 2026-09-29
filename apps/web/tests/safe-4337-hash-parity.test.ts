import { describe, expect, it } from 'vitest';
import { SafeOperationFactory, userOperationToHexValues } from '@safe-global/relay-kit';
import {
  concat,
  encodeAbiParameters,
  isAddress,
  keccak256,
  pad,
  toHex,
  type Hex,
} from 'viem';

/**
 * Hypothesis 2, refuted offline: the SafeOp hash the app captures with
 * `op.getHash()` is the same digest the on-chain `Safe4337Module` computes for
 * the operation it validates — including every hashed field.
 *
 * `getHash()` is the value the passkey signs (returned to the browser by the
 * build phase and re-checked at submit). The `Safe4337Module` (v0.3.0) computes
 * the same EIP-712 digest in `_getSafeOp`, with these constants taken verbatim
 * from the contract source:
 *
 *   SAFE_OP_TYPEHASH       = 0xc03dfc11…7ea7f
 *     keccak256("SafeOp(address safe,uint256 nonce,bytes initCode,bytes callData,
 *       uint128 verificationGasLimit,uint128 callGasLimit,uint256 preVerificationGas,
 *       uint128 maxPriorityFeePerGas,uint128 maxFeePerGas,bytes paymasterAndData,
 *       uint48 validAfter,uint48 validUntil,address entryPoint)")
 *   DOMAIN_SEPARATOR_TYPEHASH = 0x47e79534…9218
 *     keccak256("EIP712Domain(uint256 chainId,address verifyingContract)")
 *
 * The second half pins the serialization boundary: every field the digest
 * covers is present on the wire operation handed to the bundler, byte for byte.
 * It is the offline half of the T36 acceptance property — "the signature covers
 * the operation that is actually submitted" — and it is what makes a live
 * `AA24` attributable to a field changed *after* the app serialized the
 * operation rather than to this code.
 */

const MODULE = '0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226' as const;
const ENTRYPOINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const;
const CHAIN_ID = 8453n;
const SAFE = '0x1111111111111111111111111111111111111111' as const;
const PAYMASTER = '0x777777777777AeC03fd955926DbF81597e66834C' as const;

const SAFE_OP_TYPEHASH =
  '0xc03dfc11d8b10bf9cf703d558958c8c42777f785d998c62060d85a4f0ef6ea7f' as Hex;
const DOMAIN_SEPARATOR_TYPEHASH =
  '0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218' as Hex;

interface SafeOperationValues {
  readonly safe: `0x${string}`;
  readonly nonce: bigint;
  readonly initCode: Hex;
  readonly callData: Hex;
  readonly callGasLimit: bigint;
  readonly verificationGasLimit: bigint;
  readonly preVerificationGas: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly paymasterAndData: Hex;
  readonly validAfter: number;
  readonly validUntil: number;
  readonly entryPoint: `0x${string}`;
}

/** The `Safe4337Module._getSafeOp` digest, encoded exactly as the contract is. */
function moduleOperationHash(values: SafeOperationValues): Hex {
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint128' },
        { type: 'uint128' },
        { type: 'uint256' },
        { type: 'uint128' },
        { type: 'uint128' },
        { type: 'bytes32' },
        { type: 'uint48' },
        { type: 'uint48' },
        { type: 'address' },
      ],
      [
        SAFE_OP_TYPEHASH,
        values.safe,
        values.nonce,
        keccak256(values.initCode),
        keccak256(values.callData),
        values.verificationGasLimit,
        values.callGasLimit,
        values.preVerificationGas,
        values.maxPriorityFeePerGas,
        values.maxFeePerGas,
        keccak256(values.paymasterAndData),
        values.validAfter,
        values.validUntil,
        values.entryPoint,
      ],
    ),
  );
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [DOMAIN_SEPARATOR_TYPEHASH, CHAIN_ID, MODULE],
    ),
  );
  return keccak256(`0x1901${domainSeparator.slice(2)}${structHash.slice(2)}` as Hex);
}

/** A representative v0.7 operation, shaped like the live Base submission. */
function userOperation(nonce: string) {
  return {
    sender: SAFE,
    nonce,
    initCode: '0x' as Hex,
    callData: (`0x7bb37428${'ab'.repeat(32)}`) as Hex,
    callGasLimit: 509_922n,
    verificationGasLimit: 250_000n,
    preVerificationGas: 66_278n,
    maxFeePerGas: 1_200_000_000n,
    maxPriorityFeePerGas: 1_000_000n,
    paymaster: PAYMASTER,
    paymasterData: (`0x${'00'.repeat(8)}6abb4981${'ab'.repeat(40)}`) as Hex,
    paymasterVerificationGasLimit: 40_000n,
    paymasterPostOpGasLimit: 40_000n,
    signature: '0x' as Hex,
  };
}

function operationOptions() {
  return {
    chainId: CHAIN_ID,
    moduleAddress: MODULE,
    entryPoint: ENTRYPOINT,
    validAfter: 0,
    validUntil: 0,
  };
}

describe('the signed SafeOp hash equals the on-chain module digest', () => {
  for (const nonce of ['1', '16']) {
    it(`matches for nonce ${nonce}`, () => {
      const op = SafeOperationFactory.createSafeOperation(userOperation(nonce), operationOptions());
      const safeOp = op.getSafeOperation() as unknown as SafeOperationValues;

      expect(op.getHash()).toBe(moduleOperationHash(safeOp));
    });
  }
});

describe('every hashed field survives serialization to the bundler', () => {
  it('the wire operation reproduces the hashed operation field-for-field', () => {
    const op = SafeOperationFactory.createSafeOperation(userOperation('1'), operationOptions());
    const hashed = op.getSafeOperation() as unknown as SafeOperationValues;

    const wire = userOperationToHexValues(op.getUserOperation(), ENTRYPOINT) as unknown as {
      sender: string;
      nonce: Hex;
      initCode: Hex;
      callData: Hex;
      callGasLimit: Hex;
      verificationGasLimit: Hex;
      preVerificationGas: Hex;
      maxFeePerGas: Hex;
      maxPriorityFeePerGas: Hex;
      paymaster: string | null;
      paymasterData: Hex | null;
      paymasterVerificationGasLimit: Hex | null;
      paymasterPostOpGasLimit: Hex | null;
    };

    expect(wire.sender).toBe(hashed.safe);
    expect(BigInt(wire.nonce)).toBe(BigInt(hashed.nonce));
    expect(wire.initCode).toBe(hashed.initCode);
    expect(wire.callData).toBe(hashed.callData);
    expect(BigInt(wire.callGasLimit)).toBe(hashed.callGasLimit);
    expect(BigInt(wire.verificationGasLimit)).toBe(hashed.verificationGasLimit);
    expect(BigInt(wire.preVerificationGas)).toBe(hashed.preVerificationGas);
    expect(BigInt(wire.maxFeePerGas)).toBe(hashed.maxFeePerGas);
    expect(BigInt(wire.maxPriorityFeePerGas)).toBe(hashed.maxPriorityFeePerGas);

    // The bundler packs `paymasterAndData` from the same four fields the SDK
    // hashed, so the account signature covers exactly what the EntryPoint sees.
    const paymasterAndData = concat([
      wire.paymaster as Hex,
      pad(toHex(BigInt(wire.paymasterVerificationGasLimit ?? 0n)), { size: 16 }),
      pad(toHex(BigInt(wire.paymasterPostOpGasLimit ?? 0n)), { size: 16 }),
      wire.paymasterData ?? '0x',
    ]);
    expect(paymasterAndData).toBe(hashed.paymasterAndData);
    expect(isAddress(wire.paymaster ?? '')).toBe(true);
  });
});
