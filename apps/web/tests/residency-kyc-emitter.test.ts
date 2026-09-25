import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeFunctionData,
  getAddress,
  zeroHash,
  type Account,
  type Address,
  type Hex,
} from 'viem';
import {
  ATTESTED_EVENT_TOPIC,
  EAS_ABI,
  buildKycIssuancePlan,
  defaultRegisteredEasUids,
  isoDateToUnixSeconds,
  issueKycAttestation,
  issueKycAttestationFromEnv,
  kycFieldsFromVerification,
  prepareKycIssuance,
  readKycAttesterPrivateKey,
  resolveKycSchemaRegistration,
  selfNullifierToBytes32,
  type KycAttestationStore,
  type KycIssueDependencies,
} from '@/lib/residency/kyc-emitter';
import type { KycIssuanceGate } from '@/lib/residency/kyc-attestation';
import { EAS_SCHEMAS, encodeSchema } from '@kade/shared';

/**
 * The kade.kyc.v1 emitter. The plan is built from the **registered** UID and the
 * frozen encoding; the send path is exercised with an injected signer and
 * client (never a real key), and the approval guard is proven by asserting that
 * nothing is sent without it.
 */

const REGISTRY_UID =
  '0xeb5d6cfe8e91ca85f091bee9521cd611f2779b224499bb0b2f0b9ef584eb9c7b' as Hex;
const RECIPIENT = getAddress('0x1111111111111111111111111111111111111111');
const ATTESTER = getAddress('0x9907Edd6D403AC420cF1A84b10f0d134b13baa84');
const TX_HASH = `0x${'ab'.repeat(32)}` as Hex;
const ISSUED_UID = `0x${'cd'.repeat(32)}` as Hex;
const NULLIFIER_TEXT = '0x' + 'ab'.repeat(32);

const APPROVED: KycIssuanceGate = {
  onchainGateApproved: true,
  approvedBy: 'project owner',
  approvedAt: '2026-09-24',
};

function padAddress(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, '0')}` as Hex;
}

// The emitter targets the EAS core address from @kade/shared, not the registry.
const EAS_CORE = getAddress('0xC2679fBD37d54388Ce493F1DB75320D236e1815e');

/** The `Attested` log EAS emits for our schema. */
function goodLog(uid: Hex = ISSUED_UID) {
  return {
    address: EAS_CORE,
    topics: [
      ATTESTED_EVENT_TOPIC,
      padAddress(RECIPIENT),
      padAddress(ATTESTER),
      REGISTRY_UID,
    ],
    data: uid,
  };
}

interface StoreCalls {
  readonly recordIssuedAttestation: ReturnType<typeof vi.fn>;
}

function makeStore(
  overrides: Partial<{
    verification: Awaited<
      ReturnType<KycAttestationStore['latestValidVerification']>
    >;
    safe: Address | null;
    readError: Error;
  }> = {},
): { store: KycAttestationStore; calls: StoreCalls } {
  const calls: StoreCalls = { recordIssuedAttestation: vi.fn() };
  const verification =
    overrides.verification === undefined
      ? {
          profileId: '22222222-2222-2222-2222-222222222222',
          nationality: 'NL',
          over18: true,
          notSanctioned: true,
          selfNullifier: NULLIFIER_TEXT,
          expiresAt: '2030-01-01',
        }
      : overrides.verification;
  const safe = overrides.safe === undefined ? RECIPIENT : overrides.safe;

  const store: KycAttestationStore = {
    async latestValidVerification() {
      if (overrides.readError) throw overrides.readError;
      return verification;
    },
    async residentSafe() {
      if (overrides.readError) throw overrides.readError;
      return safe;
    },
    recordIssuedAttestation: calls.recordIssuedAttestation,
  };
  return { store, calls };
}

interface IssueMocks {
  readonly deps: KycIssueDependencies;
  readonly writeContract: ReturnType<typeof vi.fn>;
  readonly waitForTransactionReceipt: ReturnType<typeof vi.fn>;
  readonly calls: StoreCalls;
}

function makeIssueDeps(
  opts: {
    readonly gate?: KycIssuanceGate | null;
    readonly receiptStatus?: 'success' | 'reverted';
    readonly logs?: readonly unknown[];
    readonly storeOverrides?: Parameters<typeof makeStore>[0];
    readonly receiptThrows?: Error;
  } = {},
): IssueMocks {
  const { store, calls } = makeStore(opts.storeOverrides);
  const writeContract = vi.fn().mockResolvedValue(TX_HASH);
  const waitForTransactionReceipt = vi.fn();
  if (opts.receiptThrows) {
    waitForTransactionReceipt.mockRejectedValue(opts.receiptThrows);
  } else {
    waitForTransactionReceipt.mockResolvedValue({
      status: opts.receiptStatus ?? 'success',
      blockNumber: 42n,
      logs: opts.logs ?? [goodLog()],
    });
  }
  const account = { address: ATTESTER, type: 'local' } as unknown as Account;

  const deps: KycIssueDependencies = {
    store,
    gate: opts.gate === undefined ? APPROVED : opts.gate,
    attester: ATTESTER,
    publicClient: {
      waitForTransactionReceipt,
    } as unknown as KycIssueDependencies['publicClient'],
    walletClient: {
      writeContract,
    } as unknown as KycIssueDependencies['walletClient'],
    account,
  };
  return { deps, writeContract, waitForTransactionReceipt, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveKycSchemaRegistration', () => {
  it('resolves the committed kade.kyc.v1 UID and cross-checks the frozen schema', () => {
    const registration = resolveKycSchemaRegistration();
    expect(registration.uid).toBe(REGISTRY_UID);
    expect(registration.chainId).toBe(11155111);
    expect(registration.schema).toBe(encodeSchema(EAS_SCHEMAS['kade.kyc.v1']));
    expect(registration.easAddress).toBe(EAS_CORE);
  });

  it('refuses a registration whose schema drifted from the frozen definition', () => {
    const registry = defaultRegisteredEasUids();
    const tampered = {
      ...registry,
      registrations: registry.registrations.map((entry) =>
        entry.name === 'kade.kyc.v1'
          ? { ...entry, schema: 'string nationality' }
          : entry,
      ),
    };
    expect(() => resolveKycSchemaRegistration(tampered)).toThrow(/frozen definition/i);
  });

  it('refuses a mismatched chain or registry', () => {
    const registry = defaultRegisteredEasUids();
    expect(() =>
      resolveKycSchemaRegistration({ ...registry, chainId: 1 }),
    ).toThrow(/chain 1/i);
    expect(() =>
      resolveKycSchemaRegistration({
        ...registry,
        schemaRegistry: '0x0000000000000000000000000000000000000001',
      }),
    ).toThrow(/registry/i);
  });
});

describe('fact conversion', () => {
  it('reads a hex or decimal self nullifier as bytes32, and refuses anything else', () => {
    expect(selfNullifierToBytes32('0x1234')).toBe(`0x${'0'.repeat(60)}1234`);
    expect(selfNullifierToBytes32('255')).toBe(`0x${'0'.repeat(62)}ff`);
    expect(selfNullifierToBytes32('not-a-nullifier')).toBeNull();
    expect(selfNullifierToBytes32(null)).toBeNull();
    expect(selfNullifierToBytes32(`0x${'ab'.repeat(33)}`)).toBeNull();
  });

  it('takes the passport expiry at UTC midnight, and refuses an unreadable date', () => {
    expect(isoDateToUnixSeconds('2030-01-01')).toBe(
      Math.floor(Date.UTC(2030, 0, 1) / 1000),
    );
    expect(isoDateToUnixSeconds('2030-02-31')).toBeNull();
    expect(isoDateToUnixSeconds(null)).toBeNull();
  });

  it('blocks a verification that carries no nationality or predicates', () => {
    expect(
      kycFieldsFromVerification({
        profileId: 'p',
        nationality: null,
        over18: true,
        notSanctioned: true,
        selfNullifier: NULLIFIER_TEXT,
        expiresAt: '2030-01-01',
      }),
    ).toHaveProperty('reason');
    expect(
      kycFieldsFromVerification({
        profileId: 'p',
        nationality: 'NL',
        over18: null,
        notSanctioned: null,
        selfNullifier: NULLIFIER_TEXT,
        expiresAt: '2030-01-01',
      }),
    ).toHaveProperty('reason');
  });
});

describe('buildKycIssuancePlan', () => {
  it('encodes the attest calldata against the registered UID and the frozen fields', () => {
    const registration = resolveKycSchemaRegistration();
    const plan = buildKycIssuancePlan({
      registration,
      recipient: RECIPIENT,
      attester: ATTESTER,
      fields: {
        nationality: 'NL',
        over18: true,
        notSanctioned: true,
        selfNullifier: NULLIFIER_TEXT as Hex,
        expiresAt: 1_900_000_000,
      },
    });

    expect(plan.schemaUid).toBe(REGISTRY_UID);
    expect(plan.easAddress).toBe(EAS_CORE);
    expect(plan.recipient).toBe(RECIPIENT);
    expect(plan.attester).toBe(ATTESTER);
    expect(plan.data).toMatch(/^0x[0-9a-f]+$/i);
    expect(plan.expirationTime).toBe('0');
    expect(plan.refUID).toBe(zeroHash);
    expect(plan.value).toBe('0');

    const decoded = decodeFunctionData({
      abi: EAS_ABI,
      data: plan.calldata,
    });
    expect(decoded.functionName).toBe('attest');
    const request = decoded.args[0] as {
      schema: Hex;
      data: {
        recipient: Address;
        revocable: boolean;
        data: Hex;
        value: bigint;
      };
    };
    expect(request.schema).toBe(REGISTRY_UID);
    expect(getAddress(request.data.recipient)).toBe(RECIPIENT);
    expect(request.data.revocable).toBe(EAS_SCHEMAS['kade.kyc.v1'].revocable);
    expect(request.data.data).toBe(plan.data);
    expect(request.data.value).toBe(0n);
  });
});

describe('prepareKycIssuance', () => {
  it('is not-configured and unsent when no approval is recorded', async () => {
    const { store } = makeStore();
    const result = await prepareKycIssuance('p', { store, gate: null });
    expect(result.status).toBe('not-configured');
    expect(result.sent).toBe(false);
    expect(result).not.toHaveProperty('plan');
  });

  it('is blocked and unsent when the gate is not approved', async () => {
    const { store } = makeStore();
    const result = await prepareKycIssuance('p', {
      store,
      gate: { onchainGateApproved: false, approvedBy: 'owner', approvedAt: 'x' },
    });
    expect(result.status).toBe('blocked');
    expect(result.sent).toBe(false);
  });

  it('is blocked with the precise missing thing when there is no valid verification', async () => {
    const { store } = makeStore({ verification: null });
    const result = await prepareKycIssuance('p', { store, gate: APPROVED });
    expect(result.status).toBe('blocked');
    expect(result.sent).toBe(false);
    if (result.status === 'blocked') {
      expect(result.reason).toMatch(/no valid Self verification/i);
    }
  });

  it('is blocked when the resident has no Safe recipient', async () => {
    const { store } = makeStore({ safe: null });
    const result = await prepareKycIssuance('p', { store, gate: APPROVED });
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toMatch(/Safe/i);
    }
  });

  it('is blocked when the nullifier cannot be read as bytes32', async () => {
    const { store } = makeStore({
      verification: {
        profileId: 'p',
        nationality: 'NL',
        over18: true,
        notSanctioned: true,
        selfNullifier: 'not-a-nullifier',
        expiresAt: '2030-01-01',
      },
    });
    const result = await prepareKycIssuance('p', { store, gate: APPROVED });
    expect(result.status).toBe('blocked');
    if (result.status === 'blocked') {
      expect(result.reason).toMatch(/nullifier/i);
    }
  });

  it('prepares the calldata and marks it unsent when the facts resolve', async () => {
    const { store } = makeStore();
    const result = await prepareKycIssuance('p', {
      store,
      gate: APPROVED,
      attester: ATTESTER,
    });
    expect(result.status).toBe('prepared');
    expect(result.sent).toBe(false);
    if (result.status === 'prepared') {
      expect(result.plan.schemaUid).toBe(REGISTRY_UID);
      expect(result.plan.recipient).toBe(RECIPIENT);
      expect(result.plan.calldata).toMatch(/^0x[0-9a-f]+$/i);
      expect(result.reason).toMatch(/NOT sent/i);
    }
  });
});

describe('issueKycAttestation', () => {
  it('sends nothing without an approval', async () => {
    const mocks = makeIssueDeps({ gate: null });
    const result = await issueKycAttestation('p', mocks.deps);
    expect(result.sent).toBe(false);
    expect(result.status).toBe('not-configured');
    expect(mocks.writeContract).not.toHaveBeenCalled();
    expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(mocks.calls.recordIssuedAttestation).not.toHaveBeenCalled();
  });

  it('sends nothing when the approval is recorded but not granted', async () => {
    const mocks = makeIssueDeps({
      gate: { onchainGateApproved: false, approvedBy: 'owner', approvedAt: 'x' },
    });
    const result = await issueKycAttestation('p', mocks.deps);
    expect(result.sent).toBe(false);
    expect(result.status).toBe('blocked');
    expect(mocks.writeContract).not.toHaveBeenCalled();
  });

  it('sends the attest transaction, confirms it, mirrors the row and reports sent', async () => {
    const mocks = makeIssueDeps();
    const result = await issueKycAttestation('p', mocks.deps);

    expect(result.status).toBe('sent');
    expect(result.sent).toBe(true);
    if (result.status === 'sent') {
      expect(result.uid).toBe(ISSUED_UID);
      expect(result.txHash).toBe(TX_HASH);
      expect(result.blockNumber).toBe(42n);
      expect(result.mirrored).toBe(true);
    }

    expect(mocks.writeContract).toHaveBeenCalledTimes(1);
    const call = mocks.writeContract.mock.calls[0]![0] as {
      address: Address;
      functionName: string;
      args: readonly unknown[];
    };
    expect(call.address).toBe(EAS_CORE);
    expect(call.functionName).toBe('attest');

    expect(mocks.calls.recordIssuedAttestation).toHaveBeenCalledTimes(1);
    const mirror = mocks.calls.recordIssuedAttestation.mock.calls[0]![0] as {
      attestationUid: Hex;
      chain: number;
      selfNullifier: Hex;
      nationality: string;
    };
    expect(mirror.attestationUid).toBe(ISSUED_UID);
    expect(mirror.chain).toBe(11155111);
    expect(mirror.selfNullifier).toBe(NULLIFIER_TEXT);
    expect(mirror.nationality).toBe('NL');
  });

  it('reports failed and writes no mirror when the receipt reverted', async () => {
    const mocks = makeIssueDeps({ receiptStatus: 'reverted' });
    const result = await issueKycAttestation('p', mocks.deps);
    expect(result.status).toBe('failed');
    expect(result.sent).toBe(false);
    if (result.status === 'failed') {
      expect(result.stage).toBe('receipt');
      expect(result.txHash).toBe(TX_HASH);
    }
    expect(mocks.calls.recordIssuedAttestation).not.toHaveBeenCalled();
  });

  it('reports failed and writes no mirror when the Attested event is absent', async () => {
    const mocks = makeIssueDeps({ logs: [] });
    const result = await issueKycAttestation('p', mocks.deps);
    expect(result.status).toBe('failed');
    expect(result.sent).toBe(false);
    if (result.status === 'failed') {
      expect(result.stage).toBe('uid');
    }
    expect(mocks.calls.recordIssuedAttestation).not.toHaveBeenCalled();
  });

  it('reports sent with mirrored false when the mirror write fails', async () => {
    const mocks = makeIssueDeps();
    mocks.calls.recordIssuedAttestation.mockRejectedValue(new Error('db down'));
    const result = await issueKycAttestation('p', mocks.deps);
    expect(result.status).toBe('sent');
    expect(result.sent).toBe(true);
    if (result.status === 'sent') {
      expect(result.mirrored).toBe(false);
      expect(result.reason).toMatch(/mirror failed/i);
    }
  });
});

describe('issueKycAttestationFromEnv', () => {
  it('is not-configured without the attester key', async () => {
    const { store } = makeStore();
    const result = await issueKycAttestationFromEnv('p', store, {});
    expect(result.status).toBe('not-configured');
    expect(result.sent).toBe(false);
  });

  it('is not-configured without the RPC endpoint', async () => {
    const { store } = makeStore();
    const result = await issueKycAttestationFromEnv('p', store, {
      SEPOLIA_DEPLOYER_PRIVATE_KEY: `0x${'11'.repeat(32)}`,
    });
    expect(result.status).toBe('not-configured');
    expect(result.sent).toBe(false);
  });

  it('never reads a malformed key as an account', () => {
    expect(readKycAttesterPrivateKey({ SEPOLIA_DEPLOYER_PRIVATE_KEY: 'nope' })).toBeNull();
    expect(readKycAttesterPrivateKey({})).toBeNull();
  });
});
