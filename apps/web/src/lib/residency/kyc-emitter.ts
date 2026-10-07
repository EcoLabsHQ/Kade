import {
  encodeFunctionData,
  getAddress,
  keccak256,
  toHex,
  zeroHash,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import {
  CHAIN_IDS,
  EAS_SCHEMAS,
  chainByChainId,
  encodeSchema,
} from '@kade/shared';
import registeredEasUids from '../../../../../packages/contracts/eas/registered-uids.json';
import { encodeKycAttestationData, type KycFields } from './kyc-attestation';
import { assertKycIssuanceApproved, readKycIssuanceGate } from './kyc-attestation';
import type { KycIssuanceGate } from './kyc-attestation';

/**
 * The `kade.kyc.v1` attestation **emitter** (D16 / EXE-012).
 *
 * `./kyc-attestation` builds and validates the payload from the frozen shared
 * schema and stops at a prepared, explicitly-unsent result. This module is the
 * complete path to actually issue the attestation — encode, sign, send, confirm —
 * and it follows the same gating discipline as
 * `packages/contracts/scripts/register-eas-schemas.mjs`:
 *
 *   1. it reads the **registered** `kade.kyc.v1` UID from
 *      `packages/contracts/eas/registered-uids.json` (never a second copy) and
 *      refuses to build if the UID's schema string, chain or registry disagree
 *      with the frozen `@kade/shared` definition;
 *   2. it resolves the facts from `self_verifications` (the latest `valid` row)
 *      and the recipient from `safe_deployments` — it reads the real state
 *      rather than asserting it;
 *   3. it **refuses to sign or send unless the explicit issuance approval is
 *      recorded** (`KADE_KYC_ISSUANCE_APPROVED`, the gate `./kyc-attestation`
 *      already defines);
 *   4. a `prepared` result carries the exact calldata and `sent: false`; only a
 *      confirmed transaction yields `sent: true`, and only then is the frozen
 *      `identity_attestations` mirror written.
 *
 * The signer and clients are **injected** (`issueKycAttestation`); the
 * environment wiring reads the attester key (`SEPOLIA_DEPLOYER_PRIVATE_KEY`,
 * Kade's backend key, the same address that registered the five schemas) from
 * the server environment and never fabricates an account. This module has no
 * import-time side effects.
 *
 * Chain: Ethereum Sepolia (11155111), where the schema is registered. The
 * recipient is the resident's Safe; the attester is Kade's, so the attestation
 * is paid for by Kade and no paymaster is involved.
 */

/* -------------------------------------------------------------------------- */
/* EAS contract surface                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The EAS `attest(AttestationRequest)` entry point and the `Attested` event,
 * copied from the verified Sepolia v0.26 deployment ABI
 * (`0xC2679fBD37d54388Ce493F1DB75320D236e1815e`). `attest` returns the new
 * attestation's UID; the same UID is emitted in `Attested`.
 */
export const EAS_ABI = [
  {
    type: 'function',
    name: 'attest',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'schema', type: 'bytes32' },
          {
            name: 'data',
            type: 'tuple',
            components: [
              { name: 'recipient', type: 'address' },
              { name: 'expirationTime', type: 'uint64' },
              { name: 'revocable', type: 'bool' },
              { name: 'refUID', type: 'bytes32' },
              { name: 'data', type: 'bytes' },
              { name: 'value', type: 'uint256' },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const;

/** `keccak256("Attested(address,address,bytes32,bytes32)")`. */
export const ATTESTED_EVENT_TOPIC: Hex = keccak256(
  toHex('Attested(address,address,bytes32,bytes32)'),
);

/* -------------------------------------------------------------------------- */
/* Registered UID                                                                */
/* -------------------------------------------------------------------------- */

/** The shape of `packages/contracts/eas/registered-uids.json`. */
export interface RegisteredEasUids {
  readonly chainId: number;
  readonly schemaRegistry: string;
  readonly registrations: readonly {
    readonly name: string;
    readonly uid: string;
    readonly chainId: number;
    readonly schema: string;
  }[];
}

/** The committed record. Read once; never a second, hand-typed UID. */
export function defaultRegisteredEasUids(): RegisteredEasUids {
  return registeredEasUids as unknown as RegisteredEasUids;
}

/** A resolved, cross-checked `kade.kyc.v1` registration. */
export interface KycSchemaRegistration {
  readonly name: 'kade.kyc.v1';
  readonly uid: Hex;
  readonly chainId: number;
  readonly schema: string;
  readonly schemaRegistry: Address;
  readonly easAddress: Address;
  readonly revocable: boolean;
}

const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * Resolve and cross-check the registered `kade.kyc.v1` UID.
 *
 * Throws (rather than returning a wrong UID) when the committed registry does
 * not agree with the frozen schema, the active chain config or its own chain id.
 * A drift here means the payload would be attested against a schema nobody
 * approved, so it is refused.
 */
export function resolveKycSchemaRegistration(
  registry: RegisteredEasUids = defaultRegisteredEasUids(),
  chainId: number = CHAIN_IDS.sepolia,
): KycSchemaRegistration {
  const chain = chainByChainId(chainId);
  if (!chain || !chain.active) {
    throw new Error(
      `No active chain configuration for chain ${chainId}; cannot resolve the kade.kyc.v1 UID.`,
    );
  }
  if (registry.chainId !== chainId) {
    throw new Error(
      `The registered EAS record is for chain ${registry.chainId}, not the requested ${chainId}.`,
    );
  }
  if (
    registry.schemaRegistry.toLowerCase() !==
    chain.schemaRegistryAddress.value.toLowerCase()
  ) {
    throw new Error(
      `The registered schema registry ${registry.schemaRegistry} does not match the chain ` +
        `configuration ${chain.schemaRegistryAddress.value}.`,
    );
  }

  const entry = registry.registrations.find(
    (registration) => registration.name === 'kade.kyc.v1',
  );
  if (!entry) {
    throw new Error('No kade.kyc.v1 registration is recorded in registered-uids.json.');
  }
  if (entry.chainId !== chainId) {
    throw new Error(
      `The kade.kyc.v1 registration is for chain ${entry.chainId}, not ${chainId}.`,
    );
  }

  const frozenSchema = encodeSchema(EAS_SCHEMAS['kade.kyc.v1']);
  if (entry.schema !== frozenSchema) {
    throw new Error(
      `The registered kade.kyc.v1 schema "${entry.schema}" does not match the frozen ` +
        `definition "${frozenSchema}".`,
    );
  }

  if (typeof entry.uid !== 'string' || !BYTES32_PATTERN.test(entry.uid)) {
    throw new Error('The registered kade.kyc.v1 UID is not a 32-byte hex value.');
  }

  return {
    name: 'kade.kyc.v1',
    uid: entry.uid as Hex,
    chainId,
    schema: entry.schema,
    schemaRegistry: getAddress(chain.schemaRegistryAddress.value),
    easAddress: getAddress(chain.easAddress.value),
    revocable: EAS_SCHEMAS['kade.kyc.v1'].revocable,
  };
}

/* -------------------------------------------------------------------------- */
/* Fact resolution                                                               */
/* -------------------------------------------------------------------------- */

/** The latest valid Self verification for a resident, as stored. */
export interface SelfVerificationRecord {
  readonly profileId: string;
  readonly nationality: string | null;
  /** `null` only for a pre-fact migration row, which must not be attested. */
  readonly over18: boolean | null;
  /** `null` only for a pre-fact migration row, which must not be attested. */
  readonly notSanctioned: boolean | null;
  /** Raw Self nullifier text as stored; converted to bytes32 for the schema. */
  readonly selfNullifier: string | null;
  /** Passport expiry as an ISO date (`YYYY-MM-DD`), or null. */
  readonly expiresAt: string | null;
}

/**
 * Convert a stored Self nullifier to the schema's bytes32.
 *
 * Self's nullifier is stored as text and this repository does not assume its
 * format. A `0x` hex value is left-padded to 32 bytes; a decimal integer is
 * converted; anything else returns `null` so the emitter reports `blocked`
 * instead of attesting a guessed value.
 */
export function selfNullifierToBytes32(value: string | null): Hex | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    const hex = trimmed.slice(2);
    if (hex.length > 64) return null;
    return `0x${hex.padStart(64, '0')}` as Hex;
  }

  if (/^\d+$/.test(trimmed)) {
    let big: bigint;
    try {
      big = BigInt(trimmed);
    } catch {
      return null;
    }
    if (big < 0n || big > 2n ** 256n - 1n) return null;
    return `0x${big.toString(16).padStart(64, '0')}` as Hex;
  }

  return null;
}

/**
 * Convert the passport expiry date to the schema's `uint64` Unix seconds.
 *
 * The stored value is a calendar date (the MRZ carries no time), so the encoding
 * takes its **UTC midnight** — the convention recorded in
 * `20260924000010_self_verification_facts.sql`. An unparseable date returns
 * `null` and blocks the issue rather than inventing an expiry.
 */
export function isoDateToUnixSeconds(value: string | null): number | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const millis = Date.UTC(year, month - 1, day);
  const date = new Date(millis);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const seconds = Math.floor(millis / 1000);
  if (seconds < 0) return null;
  return seconds;
}

/** Turn a stored verification row into the frozen schema's fields, or a reason. */
export function kycFieldsFromVerification(
  record: SelfVerificationRecord,
): { readonly fields: KycFields } | { readonly reason: string } {
  if (record.nationality === null) {
    return { reason: 'the Self verification disclosed no nationality to attest.' };
  }
  const selfNullifier = selfNullifierToBytes32(record.selfNullifier);
  if (selfNullifier === null) {
    return {
      reason:
        'the Self nullifier could not be read as a 32-byte value, so it must not be guessed.',
    };
  }
  if (record.over18 === null || record.notSanctioned === null) {
    return {
      reason:
        'the Self verification predates the stored predicates, so over18/notSanctioned are unknown.',
    };
  }
  const expiresAt = isoDateToUnixSeconds(record.expiresAt);
  if (expiresAt === null) {
    return { reason: 'the Self verification carries no readable passport expiry.' };
  }
  return {
    fields: {
      nationality: record.nationality,
      over18: record.over18,
      notSanctioned: record.notSanctioned,
      selfNullifier,
      expiresAt,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Persistence seam                                                              */
/* -------------------------------------------------------------------------- */

/** What the emitter needs to read the state and mirror a confirmed issue. */
export interface KycAttestationStore {
  /** The latest `valid` Self verification for the resident, if any. */
  latestValidVerification(profileId: string): Promise<SelfVerificationRecord | null>;
  /** The resident's Safe address from `safe_deployments`, if any. */
  residentSafe(profileId: string): Promise<Address | null>;
  /** Mirror a confirmed attestation into `identity_attestations`. Idempotent on UID. */
  recordIssuedAttestation(input: {
    readonly profileId: string;
    readonly attestationUid: Hex;
    readonly chain: number;
    readonly nationality: string;
    readonly over18: boolean;
    readonly notSanctioned: boolean;
    readonly selfNullifier: Hex;
    /** UTC midnight of the passport expiry, as an ISO instant. */
    readonly expiresAt: string;
  }): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Plan + result                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A reviewable issuance plan. Numeric fields are decimal strings so the plan can
 * cross a server-action boundary without a `bigint`.
 */
export interface KycIssuancePlan {
  readonly chainId: number;
  readonly easAddress: Address;
  readonly schemaUid: Hex;
  readonly recipient: Address;
  /** The attesting account, when known; `null` while merely preparing. */
  readonly attester: Address | null;
  readonly revocable: boolean;
  /** EAS-level expiry. `0` — the expiry is carried by the `expiresAt` field. */
  readonly expirationTime: string;
  readonly refUID: Hex;
  readonly value: string;
  /** The ABI-encoded `kade.kyc.v1` data. */
  readonly data: Hex;
  /** The exact `attest(...)` calldata for review. */
  readonly calldata: Hex;
}

/**
 * The outcome of the emitter.
 *
 * `sent: true` is returned only after a transaction was sent **and** its receipt
 * confirmed on chain. Every other variant is `sent: false`, so a prepared plan
 * can never be mistaken for an issued attestation. `mirrored` says whether the
 * `identity_attestations` row was written after the send.
 */
export type KycIssuanceOutcome =
  | { readonly status: 'not-configured'; readonly sent: false; readonly reason: string }
  | { readonly status: 'blocked'; readonly sent: false; readonly reason: string }
  | {
      readonly status: 'prepared';
      readonly sent: false;
      readonly reason: string;
      readonly plan: KycIssuancePlan;
    }
  | {
      readonly status: 'sent';
      readonly sent: true;
      readonly uid: Hex;
      readonly txHash: Hex;
      readonly blockNumber: bigint;
      readonly mirrored: boolean;
      readonly reason: string;
      readonly plan: KycIssuancePlan;
    }
  | {
      readonly status: 'failed';
      readonly sent: false;
      readonly stage: 'send' | 'receipt' | 'uid';
      readonly reason: string;
      readonly txHash?: Hex;
    };

/* -------------------------------------------------------------------------- */
/* Plan building                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The structured `AttestationRequest` a plan encodes. Kept in one place so the
 * prepared calldata and the sent transaction cannot drift.
 */
export function attestRequestFromPlan(plan: KycIssuancePlan) {
  return {
    schema: plan.schemaUid,
    data: {
      recipient: plan.recipient,
      expirationTime: BigInt(plan.expirationTime),
      revocable: plan.revocable,
      refUID: plan.refUID,
      data: plan.data,
      value: BigInt(plan.value),
    },
  } as const;
}

/**
 * Build the exact `attest` plan from resolved inputs.
 *
 * `expirationTime` is `0`: the attestation does not expire at the EAS level
 * because the expiry is carried by the schema's own `expiresAt` field, which is
 * the frozen encoding. `refUID` and `value` are zero — this is a fresh, unpaid
 * attestation paid for by Kade.
 */
export function buildKycIssuancePlan(input: {
  readonly registration: KycSchemaRegistration;
  readonly recipient: Address;
  readonly attester: Address | null;
  readonly fields: KycFields;
}): KycIssuancePlan {
  const data = encodeKycAttestationData(input.fields);
  const plan: KycIssuancePlan = {
    chainId: input.registration.chainId,
    easAddress: input.registration.easAddress,
    schemaUid: input.registration.uid,
    recipient: getAddress(input.recipient),
    attester: input.attester ? getAddress(input.attester) : null,
    revocable: input.registration.revocable,
    expirationTime: '0',
    refUID: zeroHash,
    value: '0',
    data,
    calldata: '0x',
  };
  const calldata = encodeFunctionData({
    abi: EAS_ABI,
    functionName: 'attest',
    args: [attestRequestFromPlan(plan)],
  });
  return { ...plan, calldata };
}

/* -------------------------------------------------------------------------- */
/* Preparation                                                                   */
/* -------------------------------------------------------------------------- */

export interface KycPrepareDependencies {
  readonly store: KycAttestationStore;
  /** Injected for tests; defaults to the server environment gate. */
  readonly gate?: KycIssuanceGate | null;
  /** Injected for tests; defaults to the committed registered-uids record. */
  readonly registry?: RegisteredEasUids;
  /** Injected for tests; the attester named in the plan, when known. */
  readonly attester?: Address | null;
}

function resolveGate(gate: KycIssuanceGate | null | undefined): KycIssuanceGate | null {
  return gate === undefined ? readKycIssuanceGate() : gate;
}

/**
 * Prepare a `kade.kyc.v1` issuance: gate, registered UID, facts and recipient.
 *
 * Returns `not-configured` when no approval is recorded, `blocked` (with the
 * precise missing thing) when the approval or a fact is absent, and `prepared`
 * with the exact calldata and `sent: false` otherwise. It never signs or sends.
 */
export async function prepareKycIssuance(
  profileId: string,
  deps: KycPrepareDependencies,
): Promise<KycIssuanceOutcome> {
  const gate = resolveGate(deps.gate);
  if (gate === null) {
    return {
      status: 'not-configured',
      sent: false,
      reason:
        'No kade.kyc.v1 issuance approval is recorded in this environment, so nothing ' +
        'is prepared or sent.',
    };
  }

  try {
    assertKycIssuanceApproved(gate);
  } catch (cause) {
    return {
      status: 'blocked',
      sent: false,
      reason: cause instanceof Error ? cause.message : 'kade.kyc.v1 issuance blocked.',
    };
  }

  let registration: KycSchemaRegistration;
  try {
    registration = resolveKycSchemaRegistration(deps.registry);
  } catch (cause) {
    return {
      status: 'blocked',
      sent: false,
      reason:
        'the registered kade.kyc.v1 UID could not be resolved: ' +
        (cause instanceof Error ? cause.message : 'unknown error'),
    };
  }

  let verification: SelfVerificationRecord | null;
  let safeAddress: Address | null;
  try {
    [verification, safeAddress] = await Promise.all([
      deps.store.latestValidVerification(profileId),
      deps.store.residentSafe(profileId),
    ]);
  } catch (cause) {
    return {
      status: 'blocked',
      sent: false,
      reason:
        'the resident state could not be read: ' +
        (cause instanceof Error ? cause.message : 'unknown error'),
    };
  }

  if (verification === null) {
    return {
      status: 'blocked',
      sent: false,
      reason: 'no valid Self verification exists for this resident, so there is nothing to attest.',
    };
  }
  if (safeAddress === null) {
    return {
      status: 'blocked',
      sent: false,
      reason: "the resident's Safe is not recorded, so there is no recipient to attest to.",
    };
  }

  const converted = kycFieldsFromVerification(verification);
  if ('reason' in converted) {
    return { status: 'blocked', sent: false, reason: converted.reason };
  }

  const plan = buildKycIssuancePlan({
    registration,
    recipient: safeAddress,
    attester: deps.attester ?? null,
    fields: converted.fields,
  });

  return {
    status: 'prepared',
    sent: false,
    plan,
    reason:
      'The kade.kyc.v1 attestation is prepared but NOT sent. The calldata is for review; ' +
      'issuance requires the approval-gated send path.',
  };
}

/* -------------------------------------------------------------------------- */
/* Send                                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The send half, deliberately narrow (same shape as `SafeDeployWalletClient`)
 * so production callers are not forced to thread a chain generic through a call
 * they already know the chain of.
 */
export interface KycIssuanceWalletClient {
  writeContract(args: {
    readonly address: Address;
    readonly abi: readonly unknown[];
    readonly functionName: string;
    readonly args: readonly unknown[];
    readonly account: Account;
  }): Promise<Hex>;
}

export interface KycIssueDependencies extends KycPrepareDependencies {
  readonly publicClient: Pick<PublicClient, 'waitForTransactionReceipt'>;
  readonly walletClient: KycIssuanceWalletClient;
  /** The attesting account; also named in the plan. */
  readonly account: Account;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Pull the issued UID out of the EAS `Attested` log for this schema. */
function uidFromReceiptLogs(
  logs: readonly { readonly address: string; readonly topics: readonly string[]; readonly data: string }[],
  easAddress: Address,
  schemaUid: Hex,
): Hex | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== easAddress.toLowerCase()) continue;
    if (log.topics[0]?.toLowerCase() !== ATTESTED_EVENT_TOPIC.toLowerCase()) continue;
    // Attested(recipient indexed, attester indexed, uid, schema indexed)
    if (log.topics.length < 4) continue;
    if (log.topics[3]?.toLowerCase() !== schemaUid.toLowerCase()) continue;
    if (typeof log.data !== 'string' || !BYTES32_PATTERN.test(log.data)) continue;
    return log.data as Hex;
  }
  return null;
}

/**
 * Issue the attestation: prepare, guard again, send, confirm, mirror.
 *
 * The guard is re-checked immediately before the send (defence in depth), so no
 * call can broadcast without the approval record, however it was reached. The
 * mirror is written only after a confirmed receipt. A reverted or absent receipt
 * is reported as `failed` with `sent: false`.
 */
export async function issueKycAttestation(
  profileId: string,
  deps: KycIssueDependencies,
): Promise<KycIssuanceOutcome> {
  const gate = resolveGate(deps.gate);

  // The prepare step enforces the gate; the second check below is deliberate.
  const prepared = await prepareKycIssuance(profileId, {
    store: deps.store,
    gate,
    registry: deps.registry,
    attester: deps.account.address,
  });
  if (prepared.status !== 'prepared') {
    return prepared;
  }

  try {
    assertKycIssuanceApproved(
      gate ?? { onchainGateApproved: false },
    );
  } catch (cause) {
    return {
      status: 'blocked',
      sent: false,
      reason: cause instanceof Error ? cause.message : 'kade.kyc.v1 issuance blocked.',
    };
  }

  const plan = prepared.plan;

  let txHash: Hex;
  try {
    txHash = await deps.walletClient.writeContract({
      address: plan.easAddress,
      abi: EAS_ABI,
      functionName: 'attest',
      args: [attestRequestFromPlan(plan)],
      account: deps.account,
    });
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'send',
      reason: `the attestation transaction could not be sent: ${describe(cause)}`,
    };
  }

  let receipt;
  try {
    receipt = await deps.publicClient.waitForTransactionReceipt({ hash: txHash });
    if (!receipt || receipt.status !== 'success') {
      return {
        status: 'failed',
        sent: false,
        stage: 'receipt',
        reason: 'the attestation transaction reverted.',
        txHash,
      };
    }
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'receipt',
      reason: `the attestation receipt was not available: ${describe(cause)}`,
      txHash,
    };
  }

  const uid = uidFromReceiptLogs(receipt.logs, plan.easAddress, plan.schemaUid);
  if (uid === null) {
    return {
      status: 'failed',
      sent: false,
      stage: 'uid',
      reason:
        'the transaction succeeded but no EAS Attested event for the kade.kyc.v1 schema was found, ' +
        'so the issued UID cannot be recorded.',
      txHash,
    };
  }

  // The plan already encoded validated fields; the mirror re-reads the stored
  // facts so the row is derived from the same state the attestation was.
  const mirror = await mirrorIssuedAttestation(deps.store, profileId, uid, plan);

  return {
    status: 'sent',
    sent: true,
    uid,
    txHash,
    blockNumber: receipt.blockNumber,
    mirrored: mirror.mirrored,
    reason: mirror.mirrored
      ? 'The kade.kyc.v1 attestation was sent and its identity_attestations row was written.'
      : `The kade.kyc.v1 attestation was sent, but the identity_attestations mirror failed: ${mirror.reason ?? 'unknown error'}.`,
    plan,
  };
}

/**
 * Write the frozen mirror from the same facts the attestation encoded.
 *
 * The values are re-read from the store so the mirror is derived from the stored
 * state rather than from calldata, and the call happens **only** after a
 * confirmed send. A mirror failure is reported, never swallowed: the attestation
 * is on chain either way, and the caller must know the row lags.
 */
async function mirrorIssuedAttestation(
  store: KycAttestationStore,
  profileId: string,
  uid: Hex,
  plan: KycIssuancePlan,
): Promise<{ readonly mirrored: boolean; readonly reason?: string }> {
  try {
    const verification = await store.latestValidVerification(profileId);
    const safeAddress = await store.residentSafe(profileId);
    if (verification === null || safeAddress === null) {
      return { mirrored: false, reason: 'the resident state disappeared before the mirror' };
    }
    const converted = kycFieldsFromVerification(verification);
    if ('reason' in converted) {
      return { mirrored: false, reason: converted.reason };
    }
    const { fields } = converted;
    const expiresAt = isoDateToUnixSeconds(verification.expiresAt);
    if (expiresAt === null) {
      return { mirrored: false, reason: 'the passport expiry could not be read for the mirror' };
    }
    await store.recordIssuedAttestation({
      profileId,
      attestationUid: uid,
      chain: plan.chainId,
      nationality: fields.nationality,
      over18: fields.over18,
      notSanctioned: fields.notSanctioned,
      selfNullifier: fields.selfNullifier,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    });
    return { mirrored: true };
  } catch (cause) {
    return { mirrored: false, reason: describe(cause) };
  }
}

/* -------------------------------------------------------------------------- */
/* Environment wiring                                                            */
/* -------------------------------------------------------------------------- */

/** The server-only attester key: Kade's backend key. */
export const KYC_ATTESTER_KEY_ENV = 'SEPOLIA_DEPLOYER_PRIVATE_KEY' as const;
/** The Ethereum Sepolia JSON-RPC endpoint. */
export const KYC_RPC_URL_ENV = 'SEPOLIA_RPC_URL' as const;

export type KycIssuanceEnv = Readonly<Record<string, string | undefined>>;

/** Read/validate the attester key, or null when absent/malformed. */
export function readKycAttesterPrivateKey(env: KycIssuanceEnv): Hex | null {
  const raw = env[KYC_ATTESTER_KEY_ENV]?.trim();
  if (!raw || !/^0x[0-9a-fA-F]{64}$/.test(raw)) return null;
  return raw as Hex;
}

/**
 * Environment wiring for `issueKycAttestation`.
 *
 * Reads the attester key and the RPC endpoint from the server environment. When
 * either is absent the path reports `not-configured` and nothing is sent; it
 * never falls back to a fabricated account. The caller supplies the store (so
 * this module does not import Supabase at load time).
 */
export async function issueKycAttestationFromEnv(
  profileId: string,
  store: KycAttestationStore,
  env: KycIssuanceEnv = process.env,
): Promise<KycIssuanceOutcome> {
  const privateKey = readKycAttesterPrivateKey(env);
  if (!privateKey) {
    return {
      status: 'not-configured',
      sent: false,
      reason: `${KYC_ATTESTER_KEY_ENV} is not set (or is not a 32-byte hex key), so no attester account exists.`,
    };
  }
  const rpcUrl = env[KYC_RPC_URL_ENV]?.trim();
  if (!rpcUrl) {
    return {
      status: 'not-configured',
      sent: false,
      reason: `${KYC_RPC_URL_ENV} is not set, so the attestation cannot reach Ethereum Sepolia.`,
    };
  }

  const { createPublicClient, createWalletClient, http } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  const { sepolia } = await import('viem/chains');

  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({ account, chain: sepolia, transport });

  return issueKycAttestation(profileId, {
    store,
    publicClient,
    walletClient: walletClient as unknown as KycIssuanceWalletClient,
    account,
  });
}
