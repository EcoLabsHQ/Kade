import { createPublicClient, http, type Address } from 'viem';
import {
  readChainEnv,
  readMembershipChainId,
  readMembershipManagerAddress,
  readRpcUrlFor,
} from '@/lib/env';
import { readMembership, type MembershipReadClient } from './chain';
import {
  assertMembershipIssuanceApproved,
  readMembershipIssuanceGate,
  type MembershipIssuanceGate,
} from './gate';
import {
  buildMembershipTransitionPlan,
  operationForTransition,
  type MembershipOperation,
  type MembershipTransitionPlan,
} from './plan';
import type { Membership } from './abi';
import type { MembershipTransitionStore } from './store';

/**
 * Prepare a Colosseum membership transition.
 *
 * This is the app-side half of the on-chain membership flow, in the
 * repository's established "prepare and verify, never send" shape:
 *
 *   1. it refuses unless the membership issuance gate is recorded;
 *   2. it resolves the member account (the resident's Safe) and the manager
 *      address from records and configuration, never from the client;
 *   3. it reads `membershipOf` **before** preparing, so a retry cannot duplicate
 *      an issuance — an unreadable read blocks rather than assuming "none";
 *   4. it derives the operation from the read membership and the target, so an
 *      invalid transition is refused rather than encoded;
 *   5. it persists the intent, so the record exists even though nothing is sent;
 *   6. it returns a reviewable plan whose `sent` is literally `false`.
 *
 * There is no signer and no send path here. The manager's owner is the Safe, so
 * the owner-Safe execution (Safe{Wallet}, or the owner's execution path) is the
 * human step; this module only produces the calldata for it.
 */

export type MembershipTransitionOutcome =
  | { readonly status: 'not-configured'; readonly sent: false; readonly reason: string }
  | { readonly status: 'blocked'; readonly sent: false; readonly reason: string }
  | {
      readonly status: 'prepared';
      readonly sent: false;
      readonly reason: string;
      readonly plan: MembershipTransitionPlan;
    }
  | { readonly status: 'failed'; readonly sent: false; readonly reason: string };

export interface MembershipPrepareDependencies {
  readonly store: MembershipTransitionStore;
  /** The manager address, from configuration; null when unconfigured. */
  readonly managerAddress: string | null;
  /** The chain the manager is on, from configuration; null when unconfigured. */
  readonly chainId: number | null;
  /** Injected for tests; defaults to the server environment gate. */
  readonly gate?: MembershipIssuanceGate | null;
  /** The client used to read `membershipOf`; null when no RPC is configured. */
  readonly readClient?: MembershipReadClient | null;
}

function resolveGate(
  gate: MembershipIssuanceGate | null | undefined,
): MembershipIssuanceGate | null {
  return gate === undefined ? readMembershipIssuanceGate() : gate;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Prepare the transition to `target` for a resident.
 *
 * Returns `not-configured` when the gate or the manager configuration is absent,
 * `blocked` with the precise missing thing (no Safe, an unread membership, an
 * invalid transition), `prepared` with the exact calldata and `sent: false`
 * otherwise, and `failed` when the intent could not be persisted.
 */
export async function prepareMembershipTransition(input: {
  readonly profileId: string;
  readonly target: Membership;
  readonly deps: MembershipPrepareDependencies;
}): Promise<MembershipTransitionOutcome> {
  const gate = resolveGate(input.deps.gate);
  if (gate === null) {
    return {
      status: 'not-configured',
      sent: false,
      reason:
        'No Colosseum membership issuance approval is recorded in this environment, ' +
        'so no transition is prepared.',
    };
  }
  try {
    assertMembershipIssuanceApproved(gate);
  } catch (cause) {
    return { status: 'blocked', sent: false, reason: describe(cause) };
  }

  const managerAddress = input.deps.managerAddress;
  const chainId = input.deps.chainId;
  if (managerAddress === null || chainId === null) {
    return {
      status: 'not-configured',
      sent: false,
      reason:
        'The MembershipManager address and chain id are not configured, so there is ' +
        'no manager to prepare a call for.',
    };
  }

  let account: Address | null;
  try {
    account = await input.deps.store.residentAccount(input.profileId);
  } catch (cause) {
    return {
      status: 'blocked',
      sent: false,
      reason: `the resident's Safe could not be read: ${describe(cause)}`,
    };
  }
  if (account === null) {
    return {
      status: 'blocked',
      sent: false,
      reason: "the resident's Safe is not recorded, so there is no account to issue to.",
    };
  }

  if (!input.deps.readClient) {
    return {
      status: 'blocked',
      sent: false,
      reason:
        'no chain client is configured, so membershipOf cannot be read and the ' +
        'transition is not prepared (a retry must not duplicate an issuance).',
    };
  }

  const read = await readMembership({
    publicClient: input.deps.readClient,
    managerAddress,
    account,
  });
  if (read.status === 'unread') {
    return {
      status: 'blocked',
      sent: false,
      reason:
        'the current membership could not be read, so it is not assumed to be none: ' +
        read.reason,
    };
  }

  const derived = operationForTransition(read.membership, input.target);
  if ('reason' in derived) {
    return { status: 'blocked', sent: false, reason: derived.reason };
  }
  const operation: MembershipOperation = derived.operation;

  let plan: MembershipTransitionPlan;
  try {
    plan = buildMembershipTransitionPlan({
      chainId,
      managerAddress,
      account,
      operation,
      membershipBefore: read.membership,
    });
  } catch (cause) {
    return { status: 'blocked', sent: false, reason: describe(cause) };
  }

  try {
    await input.deps.store.recordIntent({
      profileId: input.profileId,
      account: plan.account,
      operation,
      chainId,
      managerAddress: plan.managerAddress,
      membershipBefore: read.membership,
    });
  } catch (cause) {
    return {
      status: 'failed',
      sent: false,
      reason: `the membership intent could not be recorded: ${describe(cause)}`,
    };
  }

  return {
    status: 'prepared',
    sent: false,
    reason:
      `The ${operation} transition is prepared but NOT sent. The calldata is for ` +
      'review; the owner Safe executes it, and this module never signs or broadcasts.',
    plan,
  };
}

/**
 * Environment wiring for {@link prepareMembershipTransition}.
 *
 * Reads the manager address, chain id and RPC from the server environment. When
 * any is absent the path reports `not-configured`/`blocked` and nothing is
 * prepared; it never fabricates a manager or a chain. The caller supplies the
 * store, so this module does not import Supabase at load time.
 */
export async function prepareMembershipTransitionFromEnv(
  profileId: string,
  target: Membership,
  store: MembershipTransitionStore,
): Promise<MembershipTransitionOutcome> {
  const managerAddress = readMembershipManagerAddress();
  const chainId = readMembershipChainId();
  const rpcUrl = readRpcUrlFor(readChainEnv());

  let readClient: MembershipReadClient | null = null;
  if (rpcUrl !== null) {
    readClient = createPublicClient({ transport: http(rpcUrl) }) as unknown as MembershipReadClient;
  }

  return prepareMembershipTransition({
    profileId,
    target,
    deps: { store, managerAddress, chainId, readClient },
  });
}
