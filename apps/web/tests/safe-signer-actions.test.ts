import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAddress, type Hex } from 'viem';
import { DEPLOYED_SAFE_PROXY_CREATION_CODE } from '@kade/shared';
import { predictedSafeAddress } from '@/lib/safe/account';

/**
 * `preparePasskeySignerDeployment` is the createSigner call path from the stored
 * credential to the factory. These tests run the whole path — derive the signer,
 * derive the Safe owner from it, simulate `createSigner` — with only the network
 * and the credential parser mocked, and assert it never sends.
 */

const hoisted = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  loadPasskeyCredential: vi.fn(),
  readSepoliaRpcUrl: vi.fn(),
  parseP256PublicKey: vi.fn(),
  readContract: vi.fn(),
  getBytecode: vi.fn(),
  simulateContract: vi.fn(),
}));

// Only the client constructor is replaced; the ABI encoding and address
// arithmetic stay real so the action builds the same call it would in
// production.
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: hoisted.readContract,
      getBytecode: hoisted.getBytecode,
      simulateContract: hoisted.simulateContract,
    }),
  };
});
vi.mock('@/lib/env', () => ({ readSepoliaRpcUrl: hoisted.readSepoliaRpcUrl }));
vi.mock('@/lib/supabase/server', () => ({ getSessionUser: hoisted.getSessionUser }));
vi.mock('@/app/account/passkey-actions', () => ({
  loadPasskeyCredential: hoisted.loadPasskeyCredential,
}));
vi.mock('@/lib/passkey/public-key', () => ({
  parseP256PublicKey: hoisted.parseP256PublicKey,
}));

import { preparePasskeySignerDeployment } from '@/app/onboarding/signer-actions';

const USER = 'user-1';
const SIGNER = getAddress('0x8d36E6FF7e49e1b665c0b83B5394606bEed804A9');
const OTHER = getAddress('0x2222222222222222222222222222222222222222');
const CODE = '0x6001600055' as Hex;
const CREATION_CODE = DEPLOYED_SAFE_PROXY_CREATION_CODE as Hex;

const EXPECTED_SAFE = predictedSafeAddress({
  userId: USER,
  signerAddress: SIGNER,
  proxyCreationCode: CREATION_CODE,
});

function signedIn(): void {
  hoisted.getSessionUser.mockResolvedValue({
    domain: 'application-session',
    provider: 'email',
    userId: USER,
    email: 'resident@example.com',
  });
  hoisted.loadPasskeyCredential.mockResolvedValue({
    credentialId: 'cred-1',
    publicKey: 'pk-1',
    signerAddress: SIGNER,
    transports: ['internal'],
    userVerification: true,
    createdAt: '2026-01-02T03:04:05.000Z',
    lastUsedAt: null,
  });
  hoisted.readSepoliaRpcUrl.mockReturnValue('http://127.0.0.1:8545');
  hoisted.parseP256PublicKey.mockReturnValue({ x: 1n, y: 2n });
  hoisted.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) => {
      if (functionName === 'getSigner') return SIGNER;
      if (functionName === 'proxyCreationCode') return CREATION_CODE;
      throw new Error(`unexpected readContract(${functionName})`);
    },
  );
  hoisted.getBytecode.mockResolvedValue(undefined);
  hoisted.simulateContract.mockResolvedValue({ result: SIGNER, request: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  signedIn();
});

describe('preparePasskeySignerDeployment', () => {
  it('prepares the signer and the Safe owner from the same address, without sending', async () => {
    const result = await preparePasskeySignerDeployment();

    expect(result).toEqual({
      status: 'ready-to-deploy',
      signerAddress: SIGNER,
      safeAddress: EXPECTED_SAFE,
    });
    expect(hoisted.simulateContract).toHaveBeenCalledTimes(1);
  });

  it('reports already-deployed when the signer already has code', async () => {
    hoisted.getBytecode.mockResolvedValue(CODE);

    const result = await preparePasskeySignerDeployment();

    expect(result.status).toBe('already-deployed');
    expect(result.signerAddress).toBe(SIGNER);
    expect(hoisted.simulateContract).not.toHaveBeenCalled();
  });

  it('reports address-mismatch when the factory would deploy another signer', async () => {
    hoisted.simulateContract.mockResolvedValue({ result: OTHER, request: {} });

    const result = await preparePasskeySignerDeployment();

    expect(result.status).toBe('address-mismatch');
    expect(console.warn).toHaveBeenCalled();
  });

  it('reports not-configured and never names the variable in the result', async () => {
    hoisted.readSepoliaRpcUrl.mockReturnValue(null);

    const result = await preparePasskeySignerDeployment();
    const serialised = JSON.stringify(result);

    expect(result.status).toBe('not-configured');
    expect(result.signerAddress).toBeNull();
    expect(serialised).not.toMatch(/SEPOLIA/);
    expect(serialised).not.toMatch(/RPC/);
    expect(console.warn).toHaveBeenCalled();
  });

  it('reports unavailable without a session or a stored credential', async () => {
    hoisted.getSessionUser.mockResolvedValue(null);
    expect((await preparePasskeySignerDeployment()).status).toBe('unavailable');

    signedIn();
    hoisted.loadPasskeyCredential.mockResolvedValue(null);
    expect((await preparePasskeySignerDeployment()).status).toBe('unavailable');

    signedIn();
    hoisted.loadPasskeyCredential.mockResolvedValue({
      credentialId: 'cred-1',
      publicKey: null,
      signerAddress: null,
      transports: ['internal'],
      userVerification: true,
      createdAt: '2026-01-02T03:04:05.000Z',
      lastUsedAt: null,
    });
    expect((await preparePasskeySignerDeployment()).status).toBe('unavailable');
  });

  it('reports failed when the credential key cannot be parsed', async () => {
    hoisted.parseP256PublicKey.mockImplementation(() => {
      throw new Error('not a P-256 key');
    });

    const result = await preparePasskeySignerDeployment();

    expect(result.status).toBe('failed');
    expect(hoisted.simulateContract).not.toHaveBeenCalled();
  });
});
