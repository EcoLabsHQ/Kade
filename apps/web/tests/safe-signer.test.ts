import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeFunctionData,
  getAddress,
  toFunctionSelector,
  type Hex,
} from 'viem';
import { SAFE_PASSKEY_MODULE } from '@kade/shared';
import {
  SAFE_WEBAUTHN_SIGNER_FACTORY_ABI,
  buildSignerDeployTransaction,
  p256Verifiers,
  preparePasskeySigner,
  signerFactoryAddress,
  type PasskeySignerDependencies,
} from '@/lib/safe/signer';

/**
 * The signer deployment engine must be provable without a network or a funded
 * account, so the client is mocked. The point under test is that the engine
 * builds and simulates `createSigner` against the factory's own code, that the
 * simulated address must equal the derived one, and that it never sends.
 */

const SIGNER = getAddress('0x8d36E6FF7e49e1b665c0b83B5394606bEed804A9');
const OTHER = getAddress('0x2222222222222222222222222222222222222222');
const CODE = '0x6001600055' as Hex;
const X = 1n;
const Y = 2n;

const FACTORY = signerFactoryAddress();
const VERIFIERS = p256Verifiers();

interface SignerMocks {
  readonly publicClient: {
    readContract: ReturnType<typeof vi.fn>;
    getBytecode: ReturnType<typeof vi.fn>;
    simulateContract: ReturnType<typeof vi.fn>;
  };
  readonly deps: PasskeySignerDependencies;
}

function makeDeps(): SignerMocks {
  const publicClient = {
    readContract: vi.fn(),
    getBytecode: vi.fn(),
    simulateContract: vi.fn(),
  };
  publicClient.readContract.mockResolvedValue(SIGNER);
  publicClient.getBytecode.mockResolvedValue(undefined);
  publicClient.simulateContract.mockResolvedValue({ result: SIGNER, request: {} });

  return {
    publicClient,
    deps: {
      publicClient: publicClient as unknown as PasskeySignerDependencies['publicClient'],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('preparePasskeySigner', () => {
  it('builds and simulates createSigner, and reports ready-to-deploy without sending', async () => {
    const mocks = makeDeps();

    const result = await preparePasskeySigner({ x: X, y: Y }, mocks.deps);

    expect(result.status).toBe('ready-to-deploy');
    if (result.status !== 'ready-to-deploy') throw new Error('expected ready');
    expect(result.signerAddress).toBe(SIGNER);
    expect(result.simulated).toBe(SIGNER);
    expect(result.factory).toBe(FACTORY);
    expect(result.gated).toBe(true);
    expect(result.transaction.value).toBe(0n);
    expect(result.transaction.to).toBe(FACTORY);

    // `getSigner` and `createSigner` are asked for the same signer, with the
    // same packed verifiers — the property that keeps the deployed signer and
    // the Safe's owner from diverging.
    expect(mocks.publicClient.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FACTORY,
        functionName: 'getSigner',
        args: [X, Y, VERIFIERS],
      }),
    );
    expect(mocks.publicClient.simulateContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: FACTORY,
        functionName: 'createSigner',
        args: [X, Y, VERIFIERS],
      }),
    );
    // There is no send path at all.
    expect(mocks.publicClient).not.toHaveProperty('writeContract');
  });

  it('encodes the transaction as createSigner(x, y, verifiers)', () => {
    const transaction = buildSignerDeployTransaction(X, Y);

    const selector = toFunctionSelector('createSigner(uint256,uint256,uint176)');
    expect(transaction.data.startsWith(selector)).toBe(true);

    const decoded = decodeFunctionData({
      abi: SAFE_WEBAUTHN_SIGNER_FACTORY_ABI,
      data: transaction.data,
    });
    expect(decoded.functionName).toBe('createSigner');
    expect(decoded.args).toEqual([X, Y, VERIFIERS]);
  });

  it('reports already-deployed and simulates nothing when the signer has code', async () => {
    const mocks = makeDeps();
    mocks.publicClient.getBytecode.mockResolvedValue(CODE);

    const result = await preparePasskeySigner({ x: X, y: Y }, mocks.deps);

    expect(result).toEqual({
      status: 'already-deployed',
      signerAddress: SIGNER,
      factory: FACTORY,
      gated: true,
    });
    expect(mocks.publicClient.simulateContract).not.toHaveBeenCalled();
  });

  it('aborts when the factory would create a different address than it derives', async () => {
    const mocks = makeDeps();
    mocks.publicClient.simulateContract.mockResolvedValue({
      result: OTHER,
      request: {},
    });

    const result = await preparePasskeySigner({ x: X, y: Y }, mocks.deps);

    expect(result.status).toBe('address-mismatch');
    if (result.status !== 'address-mismatch') throw new Error('expected mismatch');
    expect(result.derived).toBe(SIGNER);
    expect(result.simulated).toBe(OTHER);
    expect(result.gated).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });

  it('aborts when the derived signer is not the Safe owner the caller expected', async () => {
    const mocks = makeDeps();

    const result = await preparePasskeySigner(
      { x: X, y: Y, expectedSignerAddress: OTHER },
      mocks.deps,
    );

    expect(result.status).toBe('address-mismatch');
    if (result.status !== 'address-mismatch') throw new Error('expected mismatch');
    expect(result.signerAddress).toBe(OTHER);
    expect(result.derived).toBe(SIGNER);
    // The mismatch is caught before any code read or simulation.
    expect(mocks.publicClient.getBytecode).not.toHaveBeenCalled();
    expect(mocks.publicClient.simulateContract).not.toHaveBeenCalled();
  });

  it('reports a derive failure without simulating', async () => {
    const mocks = makeDeps();
    mocks.publicClient.readContract.mockRejectedValue(new Error('no code'));

    const result = await preparePasskeySigner({ x: X, y: Y }, mocks.deps);

    expect(result).toMatchObject({ status: 'failed', stage: 'derive', gated: true });
    expect(mocks.publicClient.simulateContract).not.toHaveBeenCalled();
  });

  it('reports a simulation revert as a failure', async () => {
    const mocks = makeDeps();
    mocks.publicClient.simulateContract.mockRejectedValue(
      new Error('execution reverted'),
    );

    const result = await preparePasskeySigner({ x: X, y: Y }, mocks.deps);

    expect(result).toMatchObject({ status: 'failed', stage: 'simulate', gated: true });
  });
});

describe('p256Verifiers packing', () => {
  it('packs the Daimo fallback verifier below a zero precompile slot', () => {
    const fallback = BigInt(SAFE_PASSKEY_MODULE.p256Verifier.value);
    expect(VERIFIERS).toBe(fallback);
    // 16-bit precompile slot above a 160-bit fallback address.
    expect(VERIFIERS >> 160n).toBe(0n);
    expect(VERIFIERS & ((1n << 160n) - 1n)).toBe(fallback);
    expect(VERIFIERS).toBeLessThan(1n << 176n);
  });

  it('uses the frozen factory from @kade/shared', () => {
    expect(FACTORY).toBe(
      getAddress(SAFE_PASSKEY_MODULE.safeWebAuthnSignerFactory.value),
    );
  });
});
