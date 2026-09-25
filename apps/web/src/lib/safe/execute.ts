import {
  bytesToHex,
  encodeAbiParameters,
  getAddress,
  hexToBytes,
  isAddress,
  type Address,
  type Hex,
} from 'viem';
import { CHAIN_IDS, chainByChainId } from '@kade/shared';

/**
 * The resident-Safe transaction engine (Week 2, D18 / EXE-014; the missing half
 * of EXE-011).
 *
 * A resident Safe's only owner is a `SafeWebAuthnSigner` (a contract), so a
 * transaction from the Safe is an **ERC-4337 user operation** whose signature is
 * a P-256 / WebAuthn assertion produced by the resident's passkey, and whose gas
 * is sponsored by a paymaster (Pimlico) so the resident pays nothing. This module
 * is that path: build the calls, resolve the Safe, build the user operation,
 * sign it with the passkey, submit it through Pimlico, and wait for the receipt.
 *
 * Three properties are non-negotiable, because this is an **irreversible
 * on-chain write**:
 *
 *   1. **Fail-closed.** With no recorded approval the engine returns `blocked`
 *      before it touches a signer or a bundler. The guard is asserted at the
 *      entry *and* re-asserted immediately before signing, exactly as
 *      `lib/residency/kyc-emitter.ts` does.
 *   2. **A plan is never a send.** A reviewable `plan` (`sent: false`) carries
 *      the full call list and the resolved addresses; only a confirmed receipt
 *      yields `sent: true` with a transaction hash. The two are different
 *      result variants and cannot be confused.
 *   3. **Nothing sends by default.** The network boundaries — `loadAccount`
 *      (resolve the Safe and build the user operation), `getPasskey` (produce
 *      the WebAuthn assertion) and `submit` (Pimlico bundler + paymaster, wait
 *      for the receipt) — are **injected**. Absent them, the engine stops at the
 *      plan. The repository supplies no default implementations: the real
 *      `loadAccount`/`submit` need `@safe-global/protocol-kit` (Safe4337Pack) or
 *      `permissionless`, which are not dependencies, and the signer is not
 *      deployed (D-EXE-011). That seam is named in
 *      `executeSafeTransactionFromEnv` rather than filled with a mock.
 *
 * The passkey half is implemented honestly: `encodeSafeWebAuthnSignature` packs
 * a real WebAuthn assertion (authenticator data, client-data fields, and the
 * DER-decoded `r`/`s`) into the exact struct `SafeWebAuthnSigner` verifies,
 * `WebAuthn.Signature` = `(bytes authenticatorData, string clientDataFields,
 * uint256 r, uint256 s)`. What cannot be verified without the deployed signer is
 * whether the *chain* accepts it; that is declared in `docs/known-gaps.md`.
 *
 * Chain: Ethereum Sepolia (`CHAIN_IDS.sepolia`) first, where the Safe and the
 * EAS schemas already live. The chain id is read from `@kade/shared`, never
 * hard-coded.
 */

/* -------------------------------------------------------------------------- */
/* Shapes                                                                       */
/* -------------------------------------------------------------------------- */

/** One contract call the Safe will execute. The shape `morpho-deposit` emits. */
export interface SafeCall {
  readonly to: Address;
  readonly value: bigint;
  readonly data: Hex;
}

/**
 * The passkey the resident is signing with, as carried for review.
 *
 * The private key never leaves the authenticator, so this is a reference (the
 * credential id) rather than key material. The injected `getPasskey` owns the
 * actual assertion ceremony.
 */
export interface SafePasskeyReference {
  readonly credentialId: string;
}

/** What the caller asks the engine to do. */
export interface SafeExecutionRequest {
  readonly calls: readonly SafeCall[];
  /** The resident's Safe, as persisted. The resolved account must equal it. */
  readonly safeAddress: Address;
  /** The chain to execute on. Defaults to Ethereum Sepolia. */
  readonly chainId?: number;
  readonly credential?: SafePasskeyReference;
}

/* -------------------------------------------------------------------------- */
/* Approval gate                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The explicit approval an irreversible Safe execution requires.
 *
 * Mirrors `KycIssuanceGate` / `PermitIssuanceGate`: the gate records that it was
 * approved, by whom, and when. Absent it, nothing is signed or sent.
 */
export interface SafeExecutionGate {
  readonly onchainGateApproved: boolean;
  readonly approvedBy: string;
  readonly approvedAt: string;
}

/** The server-only environment keys the gate is read from. */
export const SAFE_EXECUTION_GATE_ENV = {
  approved: 'KADE_SAFE_EXECUTION_APPROVED',
  by: 'KADE_SAFE_EXECUTION_APPROVED_BY',
  at: 'KADE_SAFE_EXECUTION_APPROVED_AT',
} as const;

export type SafeExecutionEnv = Readonly<Record<string, string | undefined>>;

/** Read the execution gate from the server environment, if recorded. */
export function readSafeExecutionGate(
  env: SafeExecutionEnv = process.env,
): SafeExecutionGate | null {
  const approved = env[SAFE_EXECUTION_GATE_ENV.approved]?.trim();
  if (!approved) return null;
  return {
    onchainGateApproved: approved === 'true',
    approvedBy: env[SAFE_EXECUTION_GATE_ENV.by]?.trim() ?? '',
    approvedAt: env[SAFE_EXECUTION_GATE_ENV.at]?.trim() ?? '',
  };
}

/** Throws unless the Onchain gate approved Safe execution. */
export function assertSafeExecutionApproved(gate: SafeExecutionGate): void {
  if (!gate.onchainGateApproved) {
    throw new Error(
      'Resident-Safe execution blocked: the Onchain gate has not been approved ' +
        '(week-2 contract section 7, checkpoint 3). A Safe transaction is irreversible.',
    );
  }
  if (!gate.approvedBy || !gate.approvedAt) {
    throw new Error(
      'Resident-Safe execution blocked: approval must record who approved it and when.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Passkey signature                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A raw WebAuthn assertion as a browser authenticator produces it.
 *
 * All three byte fields are exactly `PublicKeyCredential.response`:
 *   - `authenticatorData` — the assertion's authenticator data;
 *   - `clientDataJSON`    — the raw client data JSON bytes;
 *   - `signature`         — the DER-encoded ES256 signature.
 *
 * The engine does not create this; `navigator.credentials.get()` does, through
 * the injected `getPasskey`. Keeping the raw assertion (rather than a
 * pre-encoded signature) is what lets the encoding below be reviewed and tested.
 */
export interface SafeWebAuthnAssertion {
  readonly credentialId: string;
  readonly authenticatorData: Hex;
  readonly clientDataJSON: Hex;
  readonly signature: Hex;
}

/** The `USER_VERIFICATION` flag in authenticator data; the signer requires it. */
const USER_VERIFICATION_FLAG = 0x04;

/**
 * The client data JSON prefix/suffix the WebAuthn standard serialises.
 *
 * `clientDataFields` is everything after the challenge field, which is what the
 * on-chain `WebAuthn` library reconstructs. The challenge is 43 base64url chars
 * (32 bytes), so the prefix is fixed and can be matched exactly.
 */
const CLIENT_DATA_JSON_PATTERN =
  /^\{"type":"webauthn\.get","challenge":"([A-Za-z0-9\-_]{43})",(.*)\}$/;

function base64UrlToBytes(value: string): Uint8Array {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(
    normalised.length + ((4 - (normalised.length % 4)) % 4),
    '=',
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Decode the `r` and `s` integers from a DER-encoded ECDSA signature.
 *
 * Handles the short and long form length octets; P-256 signatures are ~70–72
 * bytes, but long-form `s` is legal and is decoded rather than assumed away.
 * Anything that is not a two-integer DER sequence throws.
 */
function decodeDerSignature(signature: Hex): { readonly r: bigint; readonly s: bigint } {
  const bytes = hexToBytes(signature);
  if (bytes.length < 8 || bytes[0] !== 0x30) {
    throw new Error('the WebAuthn signature is not a DER SEQUENCE.');
  }

  let offset = 1;
  let sequenceLength = bytes[offset]!;
  offset += 1;
  if ((sequenceLength & 0x80) !== 0) {
    const lengthBytes = sequenceLength & 0x7f;
    if (lengthBytes === 0 || lengthBytes > 3) {
      throw new Error('the WebAuthn signature has an unsupported DER length.');
    }
    sequenceLength = 0;
    for (let i = 0; i < lengthBytes; i += 1) {
      sequenceLength = (sequenceLength << 8) | bytes[offset]!;
      offset += 1;
    }
  }
  if (offset + sequenceLength !== bytes.length) {
    throw new Error('the WebAuthn signature DER length does not match its bytes.');
  }

  const readInteger = (): bigint => {
    if (bytes[offset] !== 0x02) {
      throw new Error('the WebAuthn signature is not a DER INTEGER pair.');
    }
    offset += 1;
    let length = bytes[offset]!;
    offset += 1;
    if ((length & 0x80) !== 0) {
      const lengthBytes = length & 0x7f;
      if (lengthBytes === 0 || lengthBytes > 3) {
        throw new Error('the WebAuthn signature has an unsupported DER integer length.');
      }
      length = 0;
      for (let i = 0; i < lengthBytes; i += 1) {
        length = (length << 8) | bytes[offset]!;
        offset += 1;
      }
    }
    if (length === 0 || offset + length > bytes.length) {
      throw new Error('the WebAuthn signature has a malformed DER integer.');
    }
    const value = bytes.slice(offset, offset + length);
    offset += length;
    let hex = bytesToHex(value).slice(2);
    // A DER INTEGER is signed; a leading 0x00 marks the value positive. Drop all
    // leading zero bytes so the bigint is the mathematical integer.
    hex = hex.replace(/^00+/, '');
    if (hex.length === 0) return 0n;
    return BigInt(`0x${hex}`);
  };

  const r = readInteger();
  const s = readInteger();
  if (offset !== bytes.length) {
    throw new Error('the WebAuthn signature carries trailing DER bytes.');
  }
  return { r, s };
}

/**
 * Pack a WebAuthn assertion into the exact `WebAuthn.Signature` struct the
 * `SafeWebAuthnSigner` verifies: `abi.encode(authenticatorData,
 * clientDataFields, r, s)`.
 *
 * The `challenge` is the Safe operation hash the passkey signed. This function
 * re-derives the challenge from the assertion's own `clientDataJSON` and refuses
 * to encode if it does not equal `challenge` — a passkey assertion over a
 * *different* operation hash must never become a signature for this one. It also
 * requires the `USER_VERIFICATION` flag, because `SafeWebAuthnSignerSingleton`
 * verifies with `USER_VERIFICATION` set; a presence-only assertion could not
 * validate.
 *
 * This is the honest boundary: the packing matches the published safe-modules
 * v0.2.1 `WebAuthn` library, but it cannot be proven on chain until the signer
 * is deployed (D-EXE-011). See `docs/known-gaps.md`.
 */
export function encodeSafeWebAuthnSignature(
  assertion: SafeWebAuthnAssertion,
  challenge: Hex,
): Hex {
  if (challenge.length !== 66) {
    throw new Error('the Safe operation hash must be a 32-byte hex value.');
  }

  const clientDataJSON = new TextDecoder('utf-8').decode(
    hexToBytes(assertion.clientDataJSON),
  );
  const match = CLIENT_DATA_JSON_PATTERN.exec(clientDataJSON);
  if (!match) {
    throw new Error(
      'the WebAuthn client data JSON is not a webauthn.get assertion with a single challenge.',
    );
  }
  const [, encodedChallenge, clientDataFields] = match;
  const assertionChallenge = bytesToHex(base64UrlToBytes(encodedChallenge!));
  if (assertionChallenge.toLowerCase() !== challenge.toLowerCase()) {
    throw new Error(
      'the WebAuthn challenge does not equal the Safe operation hash; refusing to encode a signature for another operation.',
    );
  }

  const authenticatorData = hexToBytes(assertion.authenticatorData);
  if (authenticatorData.length < 37) {
    throw new Error('the WebAuthn authenticator data is shorter than the minimum 37 bytes.');
  }
  if ((authenticatorData[32]! & USER_VERIFICATION_FLAG) !== USER_VERIFICATION_FLAG) {
    throw new Error(
      'the WebAuthn assertion did not perform user verification, which the Safe signer requires.',
    );
  }

  const { r, s } = decodeDerSignature(assertion.signature);

  return encodeAbiParameters(
    [
      { type: 'bytes' },
      { type: 'string' },
      { type: 'uint256' },
      { type: 'uint256' },
    ],
    [assertion.authenticatorData, clientDataFields!, r, s],
  );
}

/* -------------------------------------------------------------------------- */
/* User operation                                                               */
/* -------------------------------------------------------------------------- */

/** The ERC-4337 user operation the resident Safe would submit. */
export interface SafeUserOperationPlan {
  readonly sender: Address;
  readonly nonce: bigint;
  readonly callData: Hex;
  readonly callGasLimit: bigint;
  readonly verificationGasLimit: bigint;
  readonly preVerificationGas: bigint;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly paymasterAndData: Hex;
  /** `'0x'` until the passkey has signed. */
  readonly signature: Hex;
}

/** What `loadAccount` resolves and builds. Injected; `loadAccount` may touch the network. */
export interface LoadedSafeAccount {
  /** The resolved Safe address. Must equal the request's, or the engine refuses. */
  readonly safeAddress: Address;
  readonly chainId: number;
  readonly entryPoint: Address;
  readonly userOperation: SafeUserOperationPlan;
  /** The EIP-712 Safe operation hash the passkey signs (the WebAuthn challenge). */
  readonly safeOperationHash: Hex;
  /** The sponsoring paymaster, or `null` when none was resolved. */
  readonly paymaster: Address | null;
}

export interface LoadSafeAccountInput {
  readonly safeAddress: Address;
  readonly chainId: number;
  readonly calls: readonly SafeCall[];
  readonly credential?: SafePasskeyReference;
}

export interface GetPasskeyInput {
  readonly request: SafeExecutionRequest;
  readonly account: LoadedSafeAccount;
  readonly safeOperationHash: Hex;
}

/* -------------------------------------------------------------------------- */
/* Submission                                                                   */
/* -------------------------------------------------------------------------- */

/** A confirmed user-operation receipt. */
export interface SafeUserOperationReceipt {
  readonly transactionHash: Hex;
  readonly blockNumber: bigint;
  readonly status: 'success' | 'reverted';
}

/** What `submit` returns after waiting for the receipt. */
export interface SubmittedSafeUserOperation {
  readonly userOperationHash: Hex;
  readonly receipt: SafeUserOperationReceipt;
}

export interface SubmitSafeOperationInput {
  readonly request: SafeExecutionRequest;
  readonly account: LoadedSafeAccount;
  /** The user operation with `signature` filled with the WebAuthn signature. */
  readonly userOperation: SafeUserOperationPlan;
  readonly webAuthnSignature: Hex;
}

/**
 * The injected dependencies. Every network boundary is a function so the engine
 * is pure and testable with no network, no key and no real signer.
 */
export interface SafeExecutionDependencies {
  /** Injected for tests; defaults to the server environment gate. */
  readonly gate?: SafeExecutionGate | null;
  /**
   * Whether the direct Safe WebAuthn signer has code on chain. Defaults to
   * `false`, because it is not deployed (D-EXE-011); a post-gate caller that has
   * verified code passes `true`.
   */
  readonly signerDeployed?: boolean;
  /** Resolve the Safe and build the unsigned user operation. */
  readonly loadAccount?: (input: LoadSafeAccountInput) => Promise<LoadedSafeAccount>;
  /** Produce the passkey's WebAuthn assertion over the Safe operation hash. */
  readonly getPasskey?: (input: GetPasskeyInput) => Promise<SafeWebAuthnAssertion>;
  /** Submit the signed operation through the bundler/paymaster and wait for the receipt. */
  readonly submit?: (input: SubmitSafeOperationInput) => Promise<SubmittedSafeUserOperation>;
  readonly env?: SafeExecutionEnv;
}

/* -------------------------------------------------------------------------- */
/* Results                                                                      */
/* -------------------------------------------------------------------------- */

/** What a gate refuses for. */
export type SafeExecutionBlocker = 'approval' | 'signer' | 'account' | 'input';

/** The reviewable plan: the exact calls and the resolved addresses. `sent: false`. */
export interface SafeExecutionPlan {
  readonly chainId: number;
  readonly safeAddress: Address;
  readonly entryPoint: Address;
  readonly calls: readonly SafeCall[];
  readonly userOperation: SafeUserOperationPlan;
  readonly safeOperationHash: Hex;
  readonly paymaster: Address | null;
}

/** Where a send failed. */
export type SafeExecutionFailureStage =
  | 'validate'
  | 'load'
  | 'sign'
  | 'encode'
  | 'submit'
  | 'receipt';

/**
 * The outcome. `sent: true` is returned only after a transaction was sent **and**
 * its receipt confirmed success; every other variant is `sent: false`, so a
 * prepared plan can never be mistaken for an executed transaction.
 */
export type SafeExecutionOutcome =
  | { readonly status: 'not-configured'; readonly sent: false; readonly reason: string }
  | {
      readonly status: 'blocked';
      readonly sent: false;
      readonly missing: SafeExecutionBlocker;
      readonly reason: string;
    }
  | {
      readonly status: 'plan';
      readonly sent: false;
      readonly plan: SafeExecutionPlan;
      readonly reason: string;
    }
  | {
      readonly status: 'sent';
      readonly sent: true;
      readonly plan: SafeExecutionPlan;
      readonly webAuthnSignature: Hex;
      readonly userOperationHash: Hex;
      readonly transactionHash: Hex;
      readonly blockNumber: bigint;
      readonly reason: string;
    }
  | {
      readonly status: 'failed';
      readonly sent: false;
      readonly stage: SafeExecutionFailureStage;
      readonly reason: string;
      readonly plan?: SafeExecutionPlan;
      readonly transactionHash?: Hex;
    };

/** The plan half's outcome: never `sent: true`. */
export type SafeTransactionPreparation = Extract<
  SafeExecutionOutcome,
  { status: 'not-configured' | 'blocked' | 'plan' | 'failed' }
>;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                      */
/* -------------------------------------------------------------------------- */

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameAddress(a: Address, b: Address): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function resolveGate(deps: SafeExecutionDependencies): SafeExecutionGate | null {
  if (deps.gate === undefined) {
    return readSafeExecutionGate(deps.env ?? process.env);
  }
  return deps.gate;
}

function accountFromPlan(plan: SafeExecutionPlan): LoadedSafeAccount {
  return {
    safeAddress: plan.safeAddress,
    chainId: plan.chainId,
    entryPoint: plan.entryPoint,
    userOperation: plan.userOperation,
    safeOperationHash: plan.safeOperationHash,
    paymaster: plan.paymaster,
  };
}

function assertCalls(calls: readonly SafeCall[]): string | null {
  if (calls.length === 0) {
    return 'at least one call is required; there is nothing to execute.';
  }
  for (const call of calls) {
    if (!isAddress(call.to, { strict: false })) {
      return `a call targets an invalid address "${call.to}".`;
    }
    if (call.value < 0n) {
      return 'a call carries a negative value.';
    }
    if (!/^0x[0-9a-fA-F]*$/.test(call.data)) {
      return 'a call carries malformed calldata.';
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Prepare                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the gate, resolve the Safe and build the reviewable plan. Never signs
 * and never sends: it calls only `loadAccount`, and only after the approval gate
 * and the signer check pass.
 */
export async function prepareSafeTransaction(
  request: SafeExecutionRequest,
  deps: SafeExecutionDependencies = {},
): Promise<SafeTransactionPreparation> {
  // --- 1. The approval gate. Nothing is reached without it. -----------------
  const gate = resolveGate(deps);
  if (gate === null) {
    return {
      status: 'not-configured',
      sent: false,
      reason:
        'No resident-Safe execution approval is recorded in this environment, so ' +
        'nothing is prepared or sent. Set the KADE_SAFE_EXECUTION_APPROVED* keys ' +
        'only once the Onchain gate approves (week-2 contract section 7, checkpoint 3).',
    };
  }
  try {
    assertSafeExecutionApproved(gate);
  } catch (cause) {
    return {
      status: 'blocked',
      sent: false,
      missing: 'approval',
      reason: describe(cause),
    };
  }

  // --- 2. The signer. A signature cannot validate without it (D-EXE-011). ---
  if (!deps.signerDeployed) {
    return {
      status: 'blocked',
      sent: false,
      missing: 'signer',
      reason:
        'The direct Safe WebAuthn signer is not deployed, so a passkey signature ' +
        'cannot authorise the Safe transaction (D-EXE-011). Nothing was signed or sent.',
    };
  }

  // --- 3. Input validation. A malformed request is refused, not sent. -------
  if (!isAddress(request.safeAddress, { strict: false })) {
    return {
      status: 'blocked',
      sent: false,
      missing: 'input',
      reason: `The Safe address "${request.safeAddress}" is not a 20-byte hex address.`,
    };
  }
  const callProblem = assertCalls(request.calls);
  if (callProblem) {
    return { status: 'blocked', sent: false, missing: 'input', reason: callProblem };
  }
  const chainId = request.chainId ?? CHAIN_IDS.sepolia;
  const chain = chainByChainId(chainId);
  if (!chain) {
    return {
      status: 'blocked',
      sent: false,
      missing: 'input',
      reason: `Chain ${chainId} is not in the frozen @kade/shared chain registry.`,
    };
  }

  // --- 4. Resolve the Safe and build the user operation. --------------------
  const loadAccount = deps.loadAccount;
  if (!loadAccount) {
    return {
      status: 'blocked',
      sent: false,
      missing: 'account',
      reason:
        'No Safe account loader is supplied, so the Safe and its user operation ' +
        'cannot be resolved. The real loader needs @safe-global/protocol-kit ' +
        '(Safe4337Pack) or permissionless, which this build does not depend on.',
    };
  }

  const safeAddress = getAddress(request.safeAddress);
  let account: LoadedSafeAccount;
  try {
    account = await loadAccount({
      safeAddress,
      chainId,
      calls: request.calls,
      credential: request.credential,
    });
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'load',
      reason: `The Safe account could not be resolved: ${describe(cause)}`,
    };
  }

  if (!sameAddress(account.safeAddress, safeAddress)) {
    return {
      status: 'blocked',
      sent: false,
      missing: 'account',
      reason:
        `The loader resolved the Safe at ${account.safeAddress}, not the expected ` +
        `${safeAddress}. Executing would operate an account that was not requested.`,
    };
  }
  if (account.chainId !== chainId) {
    return {
      status: 'blocked',
      sent: false,
      missing: 'account',
      reason:
        `The loader resolved chain ${account.chainId}, not the requested chain ${chainId}.`,
    };
  }

  const plan: SafeExecutionPlan = {
    chainId,
    safeAddress: account.safeAddress,
    entryPoint: account.entryPoint,
    calls: request.calls,
    userOperation: account.userOperation,
    safeOperationHash: account.safeOperationHash,
    paymaster: account.paymaster,
  };

  return {
    status: 'plan',
    sent: false,
    plan,
    reason:
      'The resident-Safe transaction is prepared but NOT sent. The calls, the ' +
      'resolved Safe and the user operation are for review; execution needs the ' +
      'approval-gated sign and submit path.',
  };
}

/* -------------------------------------------------------------------------- */
/* Execute                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Execute the transaction: prepare, re-check the gate, sign with the passkey,
 * submit through the bundler/paymaster, and confirm.
 *
 * The gate is asserted at the entry (inside `prepare`) and again immediately
 * before signing, so no call can broadcast without the approval however it was
 * reached. Without `getPasskey` and `submit` the engine returns the plan
 * (`sent: false`); nothing is sent by default.
 */
export async function executeSafeTransaction(
  request: SafeExecutionRequest,
  deps: SafeExecutionDependencies = {},
): Promise<SafeExecutionOutcome> {
  const prepared = await prepareSafeTransaction(request, deps);
  if (prepared.status !== 'plan') {
    return prepared;
  }

  const getPasskey = deps.getPasskey;
  const submit = deps.submit;
  if (!getPasskey || !submit) {
    // The plan is complete but the signing and submission boundaries are not
    // supplied. Return the plan; never simulate a signature or a send.
    return {
      ...prepared,
      reason:
        'The resident-Safe transaction is prepared but NOT sent: no passkey ' +
        'assertion provider and/or no bundler submitter was supplied.',
    };
  }

  const plan = prepared.plan;
  const account = accountFromPlan(plan);

  // --- Defence in depth: the gate again, immediately before signing. ---------
  const gate = resolveGate(deps);
  try {
    assertSafeExecutionApproved(
      gate ?? { onchainGateApproved: false, approvedBy: '', approvedAt: '' },
    );
  } catch (cause) {
    return {
      status: 'blocked',
      sent: false,
      missing: 'approval',
      reason: describe(cause),
    };
  }

  // --- Sign: the passkey produces a real WebAuthn assertion. ----------------
  let assertion: SafeWebAuthnAssertion;
  try {
    assertion = await getPasskey({
      request,
      account,
      safeOperationHash: plan.safeOperationHash,
    });
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'sign',
      reason: `The passkey assertion could not be produced: ${describe(cause)}`,
      plan,
    };
  }

  // --- Encode: pack the assertion into the Safe signer's signature format. --
  let webAuthnSignature: Hex;
  try {
    webAuthnSignature = encodeSafeWebAuthnSignature(assertion, plan.safeOperationHash);
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'encode',
      reason: `The passkey assertion could not be encoded: ${describe(cause)}`,
      plan,
    };
  }

  const userOperation: SafeUserOperationPlan = {
    ...plan.userOperation,
    signature: webAuthnSignature,
  };

  // --- Submit through Pimlico (bundler + paymaster) and wait for the receipt.
  let submitted: SubmittedSafeUserOperation;
  try {
    submitted = await submit({
      request,
      account,
      userOperation,
      webAuthnSignature,
    });
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      stage: 'submit',
      reason: `The user operation could not be submitted: ${describe(cause)}`,
      plan,
    };
  }

  if (submitted.receipt.status !== 'success') {
    return {
      status: 'failed',
      sent: false,
      stage: 'receipt',
      reason: 'The user operation transaction reverted.',
      plan,
      transactionHash: submitted.receipt.transactionHash,
    };
  }

  return {
    status: 'sent',
    sent: true,
    plan,
    webAuthnSignature,
    userOperationHash: submitted.userOperationHash,
    transactionHash: submitted.receipt.transactionHash,
    blockNumber: submitted.receipt.blockNumber,
    reason:
      'The resident-Safe transaction was signed with the passkey, submitted through ' +
      'the bundler/paymaster and confirmed on chain.',
  };
}

/* -------------------------------------------------------------------------- */
/* Pimlico + environment wiring                                                 */
/* -------------------------------------------------------------------------- */

/** The server-only Pimlico keys. Never `NEXT_PUBLIC_`. */
export const PIMLICO_ENV_KEYS = {
  apiKey: 'PIMLICO_API_KEY',
  policyId: 'PIMLICO_POLICY_ID',
} as const;

export interface PimlicoConfig {
  readonly apiKey: string;
  readonly policyId: string;
  readonly chainId: number;
  /** The Pimlico v2 RPC endpoint; Pimlico serves bundler and paymaster there. */
  readonly rpcUrl: string;
}

/** The Pimlico v2 endpoint for a chain. The key is a query parameter. */
export function pimlicoRpcUrl(chainId: number, apiKey: string): string {
  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${apiKey}`;
}

/**
 * Read and validate the Pimlico configuration from the server environment.
 *
 * Returns `null` when either key is absent, so the caller reports
 * `not-configured` rather than constructing a bundler URL with no key. The key
 * is never logged; the caller must not return this object to the browser.
 */
export function readPimlicoConfig(
  env: SafeExecutionEnv = process.env,
  chainId: number = CHAIN_IDS.sepolia,
): PimlicoConfig | null {
  const apiKey = env[PIMLICO_ENV_KEYS.apiKey]?.trim();
  const policyId = env[PIMLICO_ENV_KEYS.policyId]?.trim();
  if (!apiKey || !policyId) return null;
  return { apiKey, policyId, chainId, rpcUrl: pimlicoRpcUrl(chainId, apiKey) };
}

/**
 * The environment-wired entry point.
 *
 * Reads the approval gate and the Pimlico keys **server-side**. When the keys
 * are present it still sends nothing: the real user-operation builder, passkey
 * assertion provider and bundler submitter are not implemented in this build.
 * They need `@safe-global/protocol-kit` (Safe4337Pack) or `permissionless`, and
 * the direct Safe WebAuthn signer is not deployed (D-EXE-011). The result names
 * that seam instead of fabricating a signature or a broadcast.
 */
export async function executeSafeTransactionFromEnv(
  request: SafeExecutionRequest,
  env: SafeExecutionEnv = process.env,
): Promise<SafeExecutionOutcome> {
  const gate = readSafeExecutionGate(env);
  if (gate === null) {
    return {
      status: 'not-configured',
      sent: false,
      reason:
        'No resident-Safe execution approval is recorded in this environment, so ' +
        'nothing is prepared or sent.',
    };
  }
  try {
    assertSafeExecutionApproved(gate);
  } catch (cause) {
    return {
      status: 'blocked',
      sent: false,
      missing: 'approval',
      reason: describe(cause),
    };
  }

  const chainId = request.chainId ?? CHAIN_IDS.sepolia;
  const pimlico = readPimlicoConfig(env, chainId);
  if (!pimlico) {
    return {
      status: 'not-configured',
      sent: false,
      reason:
        `${PIMLICO_ENV_KEYS.apiKey} and ${PIMLICO_ENV_KEYS.policyId} are not both set, ` +
        'so there is no sponsored bundler to submit through.',
    };
  }

  return {
    status: 'blocked',
    sent: false,
    missing: 'account',
    reason:
      'The Pimlico keys are configured, but this build has no resident-Safe ' +
      'user-operation builder, passkey assertion provider or bundler submitter: ' +
      'those need @safe-global/protocol-kit (Safe4337Pack) or permissionless, ' +
      'neither of which is a dependency, and the direct Safe WebAuthn signer is ' +
      'not deployed (D-EXE-011). Nothing is sent.',
  };
}
