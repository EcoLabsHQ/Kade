import { createPublicClient, http, type Address, type Hex } from 'viem';
import { ownerSafeExecutor, type SafeOwnerExecutor } from '@/lib/safe/owner-execute';
import type {
  ResidencyCheck,
  ResidencyCheckId,
  ResidencyCheckState,
} from '@/lib/residency/checks';
import { readMembership, type MembershipReadClient } from './chain';
import {
  assertMembershipIssuanceApproved,
  readMembershipIssuanceGate,
  type MembershipIssuanceGate,
} from './gate';
import { reconcileMembershipEvents, type MembershipLogClient } from './indexer';
import {
  buildMembershipTransitionPlan,
  operationForClaim,
  parseMembershipClaimTarget,
  type MembershipClaimTarget,
  type MembershipOperation,
} from './plan';
import type { MembershipClaimStore } from './store';

/**
 * Minting the Colosseum credential as part of a claim.
 *
 * The claim is a **client click**, so this path trusts nothing from the client:
 * it re-derives the four real residency checks server-side from the same
 * records the Residency step uses, reads `membershipOf` on chain before acting,
 * refuses an unread state, and only then executes the owner-Safe call.
 *
 * The human's decision fixes the trigger: claiming Residency mints the Resident
 * credential; claiming Citizenship promotes to Citizen. The user signs nothing
 * and pays nothing — the backend executes the Safe transaction with its owner
 * key.
 *
 * ## The four real checks are the gate
 *
 * `identity`, `funds`, `review` and `service-fee` must each be `met`, exactly as
 * the Residency step derives them (`@/lib/residency/checks`). A claim with any
 * unmet check mints nothing. This is the server-side re-validation; the client
 * cannot assert a check.
 *
 * ## Duplicate protection
 *
 * Before acting, the path reads `membershipOf` and refuses an unreadable read
 * (never assuming "none"). It also consults the `membership_transitions` record:
 * a transition already `confirmed` is refused even if the chain read lags. The
 * manager itself enforces the state machine (`issueResident` requires None,
 * `promoteToCitizen` requires Resident), so a duplicate can never issue.
 *
 * ## Record, then execute, then index
 *
 * The intent is written to `membership_transitions` **before** the send, so the
 * record exists even if the send fails. The resulting `MembershipChanged` event
 * is indexed and confirms the row. `sent` is literally `false` until a
 * successful receipt is indexed and the row is confirmed.
 *
 * ## The claim target is validated at runtime
 *
 * A server action's argument crosses the network, so the TypeScript annotation
 * is not a guard. The target is parsed at the boundary
 * (`parseMembershipClaimTarget`) and only `resident` / `citizen` are accepted;
 * `revoke` and any unknown value are refused and mint nothing. The operation is
 * derived with `operationForClaim`, which cannot return `revoke`, so a claim can
 * never burn a soulbound credential.
 *
 * ## The compliance-window gap (reported, not papered over)
 *
 * The Citizenship claim's 2-minute window lives in client-side `localStorage`
 * (`@/components/residency/colosseum-progress`), which the server cannot read.
 * The four checks are the enforceable gate. A server-side window is recorded in
 * `applications.colosseum_resident_since` (migration
 * `20261006000002_colosseum_compliance_window.sql`, written but NOT applied). A
 * recorded window is enforced; a readable-but-null window is **fail-closed**
 * (the clock is started and the claim refused); only an **unread** window — the
 * migration is not applied — degrades honestly to the four checks, and that is
 * reported rather than pretended.
 */

/** The four checks a Colosseum claim must have green, in display order. */
export const REQUIRED_MEMBERSHIP_CHECKS: readonly ResidencyCheckId[] = [
  'identity',
  'funds',
  'review',
  'service-fee',
];

/** A required check that is not green: `missing` when it was not derived. */
export interface UnmetMembershipCheck {
  readonly id: ResidencyCheckId;
  readonly state: ResidencyCheckState | 'missing';
}

/**
 * The four required checks that are not `met`.
 *
 * A **missing** check counts as unmet, so an empty or partial check list (for
 * example a profile with no application) can never satisfy the gate. This is
 * the fail-closed reading of "all four checks are met".
 */
export function unmetMembershipChecks(
  checks: readonly ResidencyCheck[],
): readonly UnmetMembershipCheck[] {
  return REQUIRED_MEMBERSHIP_CHECKS.flatMap<UnmetMembershipCheck>((id) => {
    const check = checks.find((candidate) => candidate.id === id);
    if (!check) return [{ id, state: 'missing' }];
    return check.state === 'met' ? [] : [{ id, state: check.state }];
  });
}

/** The server-side compliance window, matching the client's 2 minutes. */
export const COLOSSEUM_COMPLIANCE_WINDOW_MS = 120_000;

/**
 * Whether `windowMs` has elapsed since `sinceIso`, or null when there is no
 * usable start instant. A null/unreadable start is never treated as elapsed.
 */
export function complianceWindowElapsed(
  sinceIso: string | null,
  nowMs: number,
): boolean | null {
  if (sinceIso === null) return null;
  const startedAt = Date.parse(sinceIso);
  if (!Number.isFinite(startedAt)) return null;
  return nowMs - startedAt >= COLOSSEUM_COMPLIANCE_WINDOW_MS;
}

export type MembershipMintOutcome =
  | { readonly status: 'not-configured'; readonly sent: false; readonly reason: string }
  | { readonly status: 'blocked'; readonly sent: false; readonly reason: string }
  | {
      readonly status: 'failed';
      readonly sent: false;
      readonly reason: string;
      /** The transaction hash when one was broadcast, for tracing. */
      readonly txHash: Hex | null;
    }
  | {
      readonly status: 'sent';
      readonly sent: true;
      readonly reason: string;
      readonly operation: MembershipOperation;
      readonly account: Address;
      readonly txHash: Hex;
      readonly blockNumber: bigint;
      readonly eventKey: string;
    };

export interface MembershipClaimDependencies {
  readonly store: MembershipClaimStore;
  /**
   * The four real checks, re-derived server-side from the same records the
   * Residency step uses. Never supplied by the client.
   */
  readonly checks: (profileId: string) => Promise<readonly ResidencyCheck[]>;
  readonly managerAddress: string | null;
  readonly chainId: number | null;
  readonly readClient: MembershipReadClient | null;
  readonly logClient: MembershipLogClient | null;
  /** The bound owner-Safe executor; null when no signer/config is present. */
  readonly executor: SafeOwnerExecutor | null;
  /** Injected for tests; defaults to the server environment gate. */
  readonly gate?: MembershipIssuanceGate | null;
  /** Injected for tests; defaults to `Date.now()`. */
  readonly now?: () => number;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function resolveGate(
  gate: MembershipIssuanceGate | null | undefined,
): MembershipIssuanceGate | null {
  return gate === undefined ? readMembershipIssuanceGate() : gate;
}

const notConfigured = (reason: string): MembershipMintOutcome => ({
  status: 'not-configured',
  sent: false,
  reason,
});
const blocked = (reason: string): MembershipMintOutcome => ({
  status: 'blocked',
  sent: false,
  reason,
});
const failed = (reason: string, txHash: Hex | null = null): MembershipMintOutcome => ({
  status: 'failed',
  sent: false,
  reason,
  txHash,
});

/**
 * Mint the credential a Colosseum claim warrants, or refuse with the precise
 * missing thing.
 *
 * Returns `not-configured` when the issuance gate, the manager configuration or
 * the owner-Safe executor is absent; `blocked` for an unmet check, an unread
 * chain state, an invalid/duplicate transition or an unelapsed compliance
 * window; `failed` when the intent cannot be recorded, the Safe call cannot be
 * executed or the event cannot be confirmed; and `sent` with `sent: true` only
 * once a successful receipt is indexed and the transition row is confirmed.
 */
export async function mintMembershipForClaim(input: {
  readonly profileId: string;
  readonly target: MembershipClaimTarget;
  readonly deps: MembershipClaimDependencies;
}): Promise<MembershipMintOutcome> {
  const { deps } = input;
  const now = deps.now ?? Date.now;

  // 0. The claim target crosses the network, so the type annotation is not a
  //    guard: re-validate at runtime. `revoke` (and anything unknown) is not a
  //    claim target and mints nothing.
  const target = parseMembershipClaimTarget(input.target as unknown);
  if (target === null) {
    return blocked(
      `"${String(input.target)}" is not a Colosseum claim target; only resident ` +
        'and citizen can be claimed, so nothing is minted.',
    );
  }

  const gate = resolveGate(deps.gate);
  if (gate === null) {
    return notConfigured(
      'No Colosseum membership issuance approval is recorded in this environment, ' +
        'so no credential is minted.',
    );
  }
  try {
    assertMembershipIssuanceApproved(gate);
  } catch (cause) {
    return blocked(describe(cause));
  }

  const { managerAddress, chainId } = deps;
  if (managerAddress === null || chainId === null) {
    return notConfigured(
      'The MembershipManager address and chain id are not configured, so there is ' +
        'no manager to mint against.',
    );
  }

  // 1. Re-derive the four real checks server-side. A claim cannot assert them.
  let checks: readonly ResidencyCheck[];
  try {
    checks = await deps.checks(input.profileId);
  } catch (cause) {
    return blocked(`the residency checks could not be read: ${describe(cause)}`);
  }
  const unmet = unmetMembershipChecks(checks);
  if (unmet.length > 0) {
    return blocked(
      'the four residency checks are not all met, so no credential is minted: ' +
        unmet.map((check) => `${check.id} (${check.state})`).join(', ') +
        '.',
    );
  }

  // 2. The member account (the resident's Safe), resolved server-side.
  let account: Address | null;
  try {
    account = await deps.store.residentAccount(input.profileId);
  } catch (cause) {
    return blocked(`the resident's Safe could not be read: ${describe(cause)}`);
  }
  if (account === null) {
    return blocked("the resident's Safe is not recorded, so there is no account to mint to.");
  }

  // 3. The on-chain membership. An unread state never mints.
  if (deps.readClient === null) {
    return blocked(
      'no chain client is configured, so membershipOf cannot be read and no ' +
        'credential is minted.',
    );
  }
  const read = await readMembership({
    publicClient: deps.readClient,
    managerAddress,
    account,
  });
  if (read.status === 'unread') {
    return blocked(
      'the current membership could not be read, so it is not assumed to be none: ' +
        read.reason,
    );
  }

  // 4. The transition the read warrants. A claim can only issue or promote; an
  //    invalid jump is refused, not encoded.
  const derived = operationForClaim(read.membership, target);
  if ('reason' in derived) {
    return blocked(derived.reason);
  }
  const operation: MembershipOperation = derived.operation;
  // Defence in depth: a claim must never burn a soulbound credential. This is
  // unreachable while `operationForClaim` excludes revoke, and is asserted so a
  // future change cannot quietly reintroduce it.
  if (operation === 'revoke') {
    return blocked('a claim never revokes a membership, so nothing is minted.');
  }

  // 5. The record guard: a confirmed transition is refused even if the chain read
  //    lags, so a retry cannot issue twice.
  let existing;
  try {
    existing = await deps.store.transitionFor({ account, operation, chainId });
  } catch (cause) {
    return blocked(
      `the membership transition record could not be read: ${describe(cause)}`,
    );
  }
  if (existing?.status === 'confirmed') {
    return blocked(
      `the ${operation} transition is already confirmed on chain (tx ` +
        `${existing.txHash ?? 'unknown'}), so no duplicate is minted.`,
    );
  }

  // 6. The server-side compliance window.
  //
  //    - A recorded start instant is enforced: the Citizen claim is refused
  //      until two minutes have elapsed.
  //    - A readable-but-null window is **fail-closed**: the server can enforce
  //      the window, the record is simply absent (for example a Resident minted
  //      before the column existed). Start the clock now and refuse this claim,
  //      so a missing record can never bypass the wait. This also closes the
  //      TOCTOU between a Resident mint's on-chain confirmation and its
  //      best-effort window write: a concurrent claim that wins the read starts
  //      the clock and waits rather than proceeding.
  //    - An **unread** window is the only degradation: the column/function is
  //      not deployed, so the server cannot enforce anything. It is reported,
  //      never invented.
  let complianceNote = '';
  if (target === 'citizen') {
    const window = await readComplianceWindow(deps.store, input.profileId);
    if (window.status === 'unread') {
      complianceNote =
        ' The 2-minute compliance window could not be read server-side, so it ' +
        'was not enforced on this claim.';
    } else if (window.since === null) {
      try {
        await deps.store.recordColosseumResidentSince(input.profileId);
      } catch {
        // Fail closed regardless: the claim is refused below.
      }
      return blocked(
        'no server-side compliance window was recorded, so it was started now; ' +
          'the Citizen claim is refused until two minutes have elapsed.',
      );
    } else {
      const elapsed = complianceWindowElapsed(window.since, now());
      if (elapsed !== true) {
        return blocked(
          'the 2-minute compliance window has not elapsed server-side, so the ' +
            'Citizen credential is not minted.',
        );
      }
    }
  }

  // 7. The execution and confirmation seams must both be present before the
  //    intent is recorded: without them nothing could be sent or confirmed, so
  //    an intent row would be misleading.
  if (deps.executor === null) {
    return notConfigured(
      'no owner-Safe executor is configured (the signer key or owner Safe is ' +
        'absent), so the credential is not minted.',
    );
  }
  if (deps.logClient === null) {
    return notConfigured(
      'no chain log client is configured, so the MembershipChanged event could ' +
        'not be indexed and the credential is not minted.',
    );
  }

  // 8. Build the exact owner-Safe call and record the intent before sending.
  let plan;
  try {
    plan = buildMembershipTransitionPlan({
      chainId,
      managerAddress,
      account,
      operation,
      membershipBefore: read.membership,
    });
  } catch (cause) {
    return blocked(describe(cause));
  }

  const call = plan.calls[0];
  if (!call) {
    return failed('the membership plan carried no call, so nothing was sent.');
  }

  try {
    await deps.store.recordIntent({
      profileId: input.profileId,
      account: plan.account,
      operation,
      chainId,
      managerAddress: plan.managerAddress,
      membershipBefore: read.membership,
    });
  } catch (cause) {
    return failed(`the membership intent could not be recorded: ${describe(cause)}`);
  }

  // 9. Execute through the owner Safe.
  let execution;
  try {
    execution = await deps.executor({ chainId, call });
  } catch (cause) {
    return failed(
      `the owner-Safe transaction could not be executed: ${describe(cause)}`,
    );
  }
  if (!execution.success) {
    return failed('the owner-Safe transaction reverted.', execution.txHash);
  }

  // 10. Index the resulting event and confirm the row. `sent` stays false until
  //     this succeeds.
  const reconcile = await reconcileMembershipEvents({
    publicClient: deps.logClient,
    store: deps.store,
    managerAddress,
    chainId,
    fromBlock: execution.blockNumber,
    toBlock: execution.blockNumber,
  });
  if (reconcile.status !== 'read') {
    return failed(
      `the MembershipChanged event could not be read: ${reconcile.reason}`,
      execution.txHash,
    );
  }

  let confirmed;
  try {
    confirmed = await deps.store.transitionFor({ account, operation, chainId });
  } catch (cause) {
    return failed(
      `the membership transition could not be confirmed: ${describe(cause)}`,
      execution.txHash,
    );
  }
  if (confirmed?.status !== 'confirmed') {
    return failed(
      'the MembershipChanged event was not confirmed for this transition, so the ' +
        'credential is not reported as sent.',
      execution.txHash,
    );
  }

  // 11. The Resident credential starts the server-side compliance window.
  if (target === 'resident') {
    try {
      await deps.store.recordColosseumResidentSince(input.profileId);
    } catch {
      // Best-effort: a missing window degrades the Citizen gate, never blocks.
    }
  }

  return {
    status: 'sent',
    sent: true,
    reason:
      `The ${operation} transition was confirmed on chain.` + complianceNote,
    operation,
    account,
    txHash: execution.txHash,
    blockNumber: execution.blockNumber,
    eventKey: confirmed.eventKey ?? '',
  };
}

/** Read the compliance window, normalising a thrown read into `unread`. */
async function readComplianceWindow(
  store: MembershipClaimStore,
  profileId: string,
): Promise<{ status: 'known'; since: string | null } | { status: 'unread'; reason: string }> {
  try {
    return await store.colosseumResidentSince(profileId);
  } catch (cause) {
    return { status: 'unread', reason: describe(cause) };
  }
}

/* -------------------------------------------------------------------------- */
/* Environment wiring                                                         */
/* -------------------------------------------------------------------------- */

export interface MembershipClaimEnvOverrides {
  readonly store?: MembershipClaimStore;
  readonly checks?: (profileId: string) => Promise<readonly ResidencyCheck[]>;
  readonly readClient?: MembershipReadClient | null;
  readonly logClient?: MembershipLogClient | null;
  readonly executor?: SafeOwnerExecutor | null;
  readonly gate?: MembershipIssuanceGate | null;
  readonly now?: () => number;
}

/**
 * Wire {@link mintMembershipForClaim} to the server environment.
 *
 * Every value is resolved server-side: the manager, chain and RPC from
 * configuration; the four checks from the residency records; the account from
 * `safe_deployments`; and the owner-Safe executor from the owner Safe address
 * and the server-held signer key. The key is read here and bound into the
 * executor, so it never enters the mint outcome. A missing value reports
 * `not-configured`; it never fabricates one.
 */
export async function mintMembershipForClaimFromEnv(
  profileId: string,
  target: MembershipClaimTarget,
  overrides: MembershipClaimEnvOverrides = {},
): Promise<MembershipMintOutcome> {
  const {
    readMembershipManagerAddress,
    readMembershipChainId,
    readMembershipSignerPrivateKey,
    readMembershipOwnerSafeAddress,
    readRpcUrlForChain,
  } = await import('@/lib/env');
  const managerAddress = readMembershipManagerAddress();
  const chainId = readMembershipChainId();

  let readClient = overrides.readClient;
  let logClient = overrides.logClient;
  let executor = overrides.executor;

  if (readClient === undefined || logClient === undefined || executor === undefined) {
    const rpcUrl = chainId === null ? null : readRpcUrlForChain(chainId);

    const client = rpcUrl ? createPublicClient({ transport: http(rpcUrl) }) : null;
    if (readClient === undefined) {
      readClient = client as unknown as MembershipReadClient | null;
    }
    if (logClient === undefined) {
      logClient = client as unknown as MembershipLogClient | null;
    }
    if (executor === undefined) {
      const privateKey = readMembershipSignerPrivateKey();
      const ownerSafe = readMembershipOwnerSafeAddress();
      executor =
        privateKey !== null && ownerSafe !== null && rpcUrl !== null
          ? ownerSafeExecutor({
              rpcUrl,
              safeAddress: ownerSafe as Address,
              privateKey,
            })
          : null;
    }
  }

  const store = overrides.store ?? (await import('./store')).membershipTransitionStore();
  const checks =
    overrides.checks ??
    (async (id: string) => {
      const { loadResidencySnapshot } = await import('@/lib/residency/server');
      const snapshot = await loadResidencySnapshot(id);
      return snapshot?.view.checks ?? [];
    });

  return mintMembershipForClaim({
    profileId,
    target,
    deps: {
      store,
      checks,
      managerAddress,
      chainId,
      readClient: readClient ?? null,
      logClient: logClient ?? null,
      executor: executor ?? null,
      gate: overrides.gate,
      now: overrides.now,
    },
  });
}
