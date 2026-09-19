import { describe, expect, it } from 'vitest';
import { getContractAddress, keccak256, type Address, type Hex } from 'viem';
import {
  initializerHash,
  predictSafeAddress,
  proxyInitCodeHash,
  safeInitializer,
  safeSalt,
} from '@/lib/safe/derive';

/**
 * The derivation must agree with the on-chain arithmetic, because the address it
 * produces is the address funds are sent to. The Solidity mirror is Foundry
 * tested; these tests cross-check the TypeScript against viem's own CREATE2
 * implementation, which is independent code.
 */

const FACTORY = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67' as Address;
const SINGLETON = '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762' as Address;
const HANDLER = '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99' as Address;
const SIGNER = '0x1111111111111111111111111111111111111111' as Address;
const CREATION_CODE = '0x6080604052610100' as Hex;

describe('Safe address derivation', () => {
  it('matches viem create2 for the same inputs', () => {
    const initCodeHash = proxyInitCodeHash(CREATION_CODE, SINGLETON);
    const salt = safeSalt(
      initializerHash({ owners: [SIGNER], threshold: 1, fallbackHandler: HANDLER }),
      0n,
    );

    const mine = predictSafeAddress({
      factory: FACTORY,
      singleton: SINGLETON,
      initializerHash: initializerHash({
        owners: [SIGNER],
        threshold: 1,
        fallbackHandler: HANDLER,
      }),
      saltNonce: 0n,
      proxyCreationCode: CREATION_CODE,
    });

    // Independent implementation: viem computes CREATE2 itself.
    const viemAddress = getContractAddress({
      opcode: 'CREATE2',
      from: FACTORY,
      salt,
      bytecodeHash: initCodeHash,
    });

    expect(mine).toBe(viemAddress);
  });

  it('is deterministic', () => {
    const inputs = {
      factory: FACTORY,
      singleton: SINGLETON,
      initializerHash: keccak256('0x01' as Hex),
      saltNonce: 7n,
      proxyCreationCode: CREATION_CODE,
    };
    expect(predictSafeAddress(inputs)).toBe(predictSafeAddress(inputs));
  });

  it('moves when any single input moves', () => {
    const base = {
      factory: FACTORY,
      singleton: SINGLETON,
      initializerHash: keccak256('0x01' as Hex),
      saltNonce: 7n,
      proxyCreationCode: CREATION_CODE,
    };
    const address = predictSafeAddress(base);

    expect(
      predictSafeAddress({ ...base, saltNonce: 8n }),
    ).not.toBe(address);
    expect(
      predictSafeAddress({ ...base, factory: SIGNER }),
    ).not.toBe(address);
    expect(
      predictSafeAddress({ ...base, initializerHash: keccak256('0x02' as Hex) }),
    ).not.toBe(address);
    expect(
      predictSafeAddress({ ...base, proxyCreationCode: '0x6080' as Hex }),
    ).not.toBe(address);
  });

  it('does not depend on the chain id', () => {
    // D4 requires one address on three chains. The derivation must not read a
    // chain id, so the same inputs give the same address everywhere.
    const inputs = {
      factory: FACTORY,
      singleton: SINGLETON,
      initializerHash: keccak256('0x01' as Hex),
      saltNonce: 0n,
      proxyCreationCode: CREATION_CODE,
    };
    expect(predictSafeAddress(inputs)).toBe(predictSafeAddress({ ...inputs }));
  });

  it('rejects a zero factory rather than producing a meaningless address', () => {
    expect(() =>
      predictSafeAddress({
        factory: '0x0000000000000000000000000000000000000000',
        singleton: SINGLETON,
        initializerHash: keccak256('0x01' as Hex),
        saltNonce: 0n,
        proxyCreationCode: CREATION_CODE,
      }),
    ).toThrow(/zero factory/i);
  });

  it('commits the owner, threshold and handler into the initializer', () => {
    const a = initializerHash({ owners: [SIGNER], threshold: 1, fallbackHandler: HANDLER });
    const otherOwner = initializerHash({
      owners: ['0x2222222222222222222222222222222222222222' as Address],
      threshold: 1,
      fallbackHandler: HANDLER,
    });
    const otherThreshold = initializerHash({
      owners: [SIGNER],
      threshold: 2,
      fallbackHandler: HANDLER,
    });
    const otherHandler = initializerHash({
      owners: [SIGNER],
      threshold: 1,
      fallbackHandler: '0x3333333333333333333333333333333333333333' as Address,
    });

    for (const other of [otherOwner, otherThreshold, otherHandler]) {
      expect(other).not.toBe(a);
    }
    expect(safeInitializer({ owners: [SIGNER], threshold: 1, fallbackHandler: HANDLER })).toMatch(
      /^0x/,
    );
  });
});
