import { getAddress, type Address } from 'viem';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Membership } from './abi';
import type { MembershipOperation } from './plan';

/**
 * The Supabase-backed membership transition store.
 *
 * The module's own code stays free of Supabase and `next/*` imports; this is the
 * wiring. It reads the real state rather than asserting it:
 *
 *   - the member account is the resident's Safe, from `safe_deployments`;
 *   - the intent is written through `record_membership_intent`, a
 *     `SECURITY DEFINER` function granted only to `service_role`
 *     (migration `20261006000001`);
 *   - an indexed `MembershipChanged` event is written through
 *     `record_membership_event`, which is idempotent on the event key and
 *     promotes a matching pending intent to `confirmed`.
 *
 * The server path has no resident session here, so the default store uses the
 * elevated service client. Both clients are injected, so a test can pass a fake
 * without a database or a key.
 */

export interface MembershipIntentInput {
  readonly profileId: string;
  readonly account: Address;
  readonly operation: MembershipOperation;
  readonly chainId: number;
  readonly managerAddress: Address;
  readonly membershipBefore: Membership | null;
}

export interface MembershipEventInput {
  readonly account: Address;
  readonly operation: MembershipOperation;
  readonly chainId: number;
  readonly managerAddress: Address;
  /** `txHash:logIndex`, lowercase. */
  readonly eventKey: string;
  readonly txHash: string;
  readonly membershipBefore: Membership | null;
  readonly membershipAfter: Membership;
  readonly blockNumber: bigint;
}

export interface MembershipTransitionStore {
  /** The resident's Safe address, or null when none is recorded. */
  residentAccount(profileId: string): Promise<Address | null>;
  /** Record (or refresh) the reviewable intent. Idempotent. */
  recordIntent(input: MembershipIntentInput): Promise<void>;
  /** Record an indexed event, promoting a matching intent. Idempotent. */
  recordEvent(input: MembershipEventInput): Promise<{ readonly recorded: boolean }>;
}

/** The latest recorded transition for one `(account, operation, chain)`. */
export interface MembershipTransitionLookup {
  readonly status: 'prepared' | 'submitted' | 'confirmed' | 'failed';
  readonly txHash: string | null;
  readonly eventKey: string | null;
  readonly membershipAfter: Membership | null;
}

/**
 * The Colosseum compliance-window start for a profile.
 *
 * `known` distinguishes "the record was read and there is (or is not) an
 * instant" from `unread` — a failed or unavailable read. An `unread` window is
 * never collapsed into "not started": the mint reports it rather than inventing
 * an elapsed window.
 */
export type ColosseumWindowRead =
  | { readonly status: 'known'; readonly since: string | null }
  | { readonly status: 'unread'; readonly reason: string };

/**
 * The store capability the claim/mint path needs on top of the prepare path.
 *
 * Kept separate from {@link MembershipTransitionStore} so the existing prepare
 * flow and its tests are untouched: the concrete store implements both, and the
 * narrower interface remains assignable to the wider one.
 */
export interface MembershipClaimStore extends MembershipTransitionStore {
  /**
   * The passkey signer (the Safe's only owner) recorded for the resident, or
   * null. It is the one derivation input the deploy engine needs to re-derive
   * and deploy the recorded address on a chain where the Safe has no code yet.
   * Never supplied by the client.
   */
  residentSafeOwner(profileId: string): Promise<Address | null>;
  /**
   * The latest transition row for the account and operation, or null. Used as a
   * second duplicate guard beside the on-chain `membershipOf` read: a retry
   * whose event was already confirmed is refused even if the chain read lags.
   */
  transitionFor(input: {
    readonly account: Address;
    readonly operation: MembershipOperation;
    readonly chainId: number;
  }): Promise<MembershipTransitionLookup | null>;
  /** Read the recorded compliance-window start. */
  colosseumResidentSince(profileId: string): Promise<ColosseumWindowRead>;
  /** Record the compliance-window start once. Idempotent. */
  recordColosseumResidentSince(profileId: string): Promise<void>;
}

export interface MembershipStoreClients {
  readonly getClient: () => Promise<SupabaseClient>;
}

interface SafeRow {
  readonly safe_address: string;
  readonly profile_id: string;
}

export function createMembershipTransitionStore(
  clients: MembershipStoreClients,
): MembershipClaimStore {
  async function client(): Promise<SupabaseClient> {
    return clients.getClient();
  }

  async function profileForAccount(account: Address): Promise<string | null> {
    const supabase = await client();
    const { data, error } = await supabase
      .from('safe_deployments')
      .select('profile_id,safe_address')
      .eq('safe_address', account)
      .maybeSingle();
    if (error) {
      throw new Error(`loading the account's profile failed: ${error.message}`);
    }
    return data ? (data as SafeRow).profile_id : null;
  }

  return {
    async residentAccount(profileId) {
      const supabase = await client();
      const { data, error } = await supabase
        .from('safe_deployments')
        .select('safe_address')
        .eq('profile_id', profileId)
        .order('predicted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(`loading the resident Safe failed: ${error.message}`);
      }
      return data ? getAddress((data as { safe_address: string }).safe_address) : null;
    },

    async residentSafeOwner(profileId) {
      const supabase = await client();
      const { data, error } = await supabase
        .from('safe_deployments')
        .select('owner')
        .eq('profile_id', profileId)
        .order('predicted_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(`loading the resident Safe owner failed: ${error.message}`);
      }
      return data ? getAddress((data as { owner: string }).owner) : null;
    },

    async recordIntent(input) {
      const supabase = await client();
      const { error } = await supabase.rpc('record_membership_intent', {
        p_profile_id: input.profileId,
        p_account: input.account,
        p_operation: input.operation,
        p_chain_id: input.chainId,
        p_manager_address: input.managerAddress,
        p_membership_before: input.membershipBefore,
      });
      if (error) {
        throw new Error(`recording the membership intent failed: ${error.message}`);
      }
    },

    async recordEvent(input) {
      const supabase = await client();
      const profileId = await profileForAccount(input.account);
      const { error } = await supabase.rpc('record_membership_event', {
        p_account: input.account,
        p_operation: input.operation,
        p_chain_id: input.chainId,
        p_manager_address: input.managerAddress,
        p_event_key: input.eventKey,
        p_tx_hash: input.txHash,
        p_membership_before: input.membershipBefore,
        p_membership_after: input.membershipAfter,
        p_block_number: input.blockNumber.toString(),
        p_profile_id: profileId,
      });
      if (error) {
        throw new Error(`recording the membership event failed: ${error.message}`);
      }
      // The writer is idempotent; a replay is the same row. "recorded" is true
      // whenever the write succeeded, so the indexer counts applied rows.
      return { recorded: true };
    },

    async transitionFor(input) {
      const supabase = await client();
      const { data, error } = await supabase
        .from('membership_transitions')
        .select('status,tx_hash,event_key,membership_after')
        .eq('chain_id', input.chainId)
        .eq('account', input.account)
        .eq('operation', input.operation)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        throw new Error(`loading the membership transition failed: ${error.message}`);
      }
      if (!data) return null;
      const row = data as {
        status: string;
        tx_hash: string | null;
        event_key: string | null;
        membership_after: string | null;
      };
      return {
        status: row.status as MembershipTransitionLookup['status'],
        txHash: row.tx_hash,
        eventKey: row.event_key,
        membershipAfter: (row.membership_after as Membership | null) ?? null,
      };
    },

    async colosseumResidentSince(profileId) {
      const supabase = await client();
      const { data, error } = await supabase
        .from('applications')
        .select('colosseum_resident_since')
        .eq('profile_id', profileId)
        .maybeSingle();
      if (error) {
        return {
          status: 'unread',
          reason: `the compliance window could not be read: ${error.message}`,
        };
      }
      const since =
        (data as { colosseum_resident_since: string | null } | null)
          ?.colosseum_resident_since ?? null;
      return { status: 'known', since };
    },

    async recordColosseumResidentSince(profileId) {
      const supabase = await client();
      const { error } = await supabase.rpc('record_colosseum_resident_since', {
        p_profile_id: profileId,
      });
      if (error) {
        throw new Error(`recording the compliance window failed: ${error.message}`);
      }
    },
  };
}

/**
 * The store backed by the real service client.
 *
 * The service-role key is required: `membership_transitions` is not writable by
 * a resident, and the prepare path carries no session. The dynamic import keeps
 * `next/headers` out of the module load.
 */
export function membershipTransitionStore(): MembershipClaimStore {
  return createMembershipTransitionStore({
    getClient: async () => {
      const { createSupabaseServiceClient } = await import('@/lib/supabase/server');
      return createSupabaseServiceClient();
    },
  });
}
