import {
  decodeEventLog,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { MEMBERSHIP_MANAGER_ABI, membershipFromOrdinal, type Membership } from './abi';
import type { MembershipOperation } from './plan';
import type { MembershipTransitionStore } from './store';

/**
 * The `MembershipChanged` indexer.
 *
 * It reads the manager's `MembershipChanged` logs and reconciles the stored
 * state, idempotently. The two rules that matter:
 *
 *   - **It never assumes.** A log that cannot be decoded is skipped, not
 *     guessed. A chain read that fails returns `unread`, which is reported as
 *     unread — never as "no membership" and never as an applied change.
 *   - **A replay is the same row.** The event key (`txHash:logIndex`) is the
 *     store's idempotency key, so reconciling the same range twice changes
 *     nothing after the first pass.
 *
 * No signer and no wallet are involved: this module only reads logs and writes
 * the mirror through the injected store.
 */

/** The minimal client surface the indexer reads. */
export interface MembershipLogClient {
  getLogs(args: {
    readonly address: Address;
    readonly fromBlock: bigint;
    readonly toBlock: bigint | 'latest';
  }): Promise<readonly RawMembershipLog[]>;
}

/** The raw log fields the indexer reads. */
export interface RawMembershipLog {
  readonly address: string;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly transactionHash?: Hex | null;
  readonly logIndex?: number | null;
  readonly blockNumber?: bigint | null;
}

export interface MembershipChangedEvent {
  readonly eventKey: string;
  readonly account: Address;
  readonly previous: Membership;
  readonly current: Membership;
  readonly operation: MembershipOperation;
  readonly txHash: Hex;
  readonly blockNumber: bigint;
}

export type MembershipReconcileResult =
  | {
      readonly status: 'read';
      readonly applied: number;
      readonly skipped: number;
    }
  | { readonly status: 'unread'; readonly reason: string }
  | { readonly status: 'failed'; readonly reason: string };

/** `txHash:logIndex`, lowercase — the event's stable identifier. */
export function membershipEventKey(txHash: string, logIndex: number): string {
  return `${txHash.toLowerCase()}:${logIndex}`;
}

/**
 * The operation a previous→current transition represents, or null when the pair
 * is not one the manager emits. An unrecognised pair is skipped, never guessed.
 */
export function operationForEvent(
  previous: Membership,
  current: Membership,
): MembershipOperation | null {
  if (previous === 'none' && current === 'resident') return 'issue-resident';
  if (previous === 'resident' && current === 'citizen') return 'promote-to-citizen';
  if ((previous === 'resident' || previous === 'citizen') && current === 'none') {
    return 'revoke';
  }
  return null;
}

/**
 * Decode one raw log into a {@link MembershipChangedEvent}, or null when it is
 * not a decodable `MembershipChanged` event.
 */
export function decodeMembershipChangedLog(
  log: RawMembershipLog,
): MembershipChangedEvent | null {
  if (typeof log.transactionHash !== 'string' || log.transactionHash.length === 0) {
    return null;
  }
  if (typeof log.logIndex !== 'number' || log.logIndex < 0) return null;
  if (typeof log.blockNumber !== 'bigint' || log.blockNumber < 0n) return null;

  let decoded: { readonly args?: unknown };
  try {
    decoded = decodeEventLog({
      abi: MEMBERSHIP_MANAGER_ABI,
      eventName: 'MembershipChanged',
      topics: log.topics as [Hex, ...Hex[]],
      data: log.data,
    }) as { readonly args?: unknown };
  } catch {
    return null;
  }

  const args = decoded.args as
    | { readonly account?: unknown; readonly previous?: unknown; readonly current?: unknown }
    | undefined;
  if (!args || typeof args.account !== 'string') return null;
  if (typeof args.previous !== 'number' && typeof args.previous !== 'bigint') return null;
  if (typeof args.current !== 'number' && typeof args.current !== 'bigint') return null;

  const previous = membershipFromOrdinal(args.previous);
  const current = membershipFromOrdinal(args.current);
  if (previous === null || current === null) return null;

  const operation = operationForEvent(previous, current);
  if (operation === null) return null;

  return {
    eventKey: membershipEventKey(log.transactionHash, log.logIndex),
    account: getAddress(args.account),
    previous,
    current,
    operation,
    txHash: log.transactionHash as Hex,
    blockNumber: log.blockNumber,
  };
}

/**
 * Read and reconcile `MembershipChanged` logs over a block range.
 *
 * A failed read is `unread` with its reason. A log that does not decode, or a
 * pair the manager never emits, is counted `skipped` rather than applied. A
 * store write failure is `failed`, so a partial reconcile is visible.
 */
export async function reconcileMembershipEvents(input: {
  readonly publicClient: MembershipLogClient;
  readonly store: MembershipTransitionStore;
  readonly managerAddress: string;
  readonly chainId: number;
  readonly fromBlock: bigint;
  readonly toBlock: bigint | 'latest';
}): Promise<MembershipReconcileResult> {
  const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
  if (!ADDRESS_PATTERN.test(input.managerAddress)) {
    return {
      status: 'unread',
      reason: `The manager address "${input.managerAddress}" is not a 20-byte hex address.`,
    };
  }

  let logs: readonly RawMembershipLog[];
  try {
    logs = await input.publicClient.getLogs({
      address: getAddress(input.managerAddress),
      fromBlock: input.fromBlock,
      toBlock: input.toBlock,
    });
  } catch (cause) {
    return {
      status: 'unread',
      reason:
        'the MembershipChanged logs could not be read: ' +
        (cause instanceof Error ? cause.message : String(cause)),
    };
  }

  let applied = 0;
  let skipped = 0;
  for (const log of logs) {
    const event = decodeMembershipChangedLog(log);
    if (event === null) {
      skipped += 1;
      continue;
    }
    try {
      const result = await input.store.recordEvent({
        account: event.account,
        operation: event.operation,
        chainId: input.chainId,
        managerAddress: getAddress(input.managerAddress),
        eventKey: event.eventKey,
        txHash: event.txHash,
        membershipBefore: event.previous,
        membershipAfter: event.current,
        blockNumber: event.blockNumber,
      });
      // `recorded: false` means the event key was already present: a replay is
      // counted as skipped, not applied, so the reconcile is idempotent.
      if (result.recorded) applied += 1;
      else skipped += 1;
    } catch (cause) {
      return {
        status: 'failed',
        reason:
          `the event ${event.eventKey} could not be recorded: ` +
          (cause instanceof Error ? cause.message : String(cause)),
      };
    }
  }

  return { status: 'read', applied, skipped };
}
