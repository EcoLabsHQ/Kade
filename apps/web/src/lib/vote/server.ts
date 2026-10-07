import { createPublicClient, getAddress, http, type Address } from 'viem';
import { readRpcUrlForChain } from '@/lib/env';
import {
  createRealSnapshotAdapter,
  type SnapshotAdapter,
  type VoteChainReader,
} from './adapter';
import { createSnapshotHubClient } from './hub';
import { VOTE_CHAIN_ID } from './spaces';
import type { VoteProposal, VotingPowerRead } from './types';

/**
 * The server-side Vote loader.
 *
 * The real adapter needs the server-only Arbitrum RPC endpoint, so it is built
 * and used here (a server component), not in the browser. The screen receives
 * the resolved, serialisable result: the proposals and one voting-power read per
 * proposal. The Snapshot hub client and the chain reader are constructed with
 * the environment's own wiring; nothing in this module writes to Snapshot or the
 * chain.
 */

/** The serialisable result the Vote page hands to the screen. */
export interface VoteData {
  readonly proposals: readonly VoteProposal[];
  readonly powers: Readonly<Record<string, VotingPowerRead>>;
  /** A read failure, or null when the load succeeded. */
  readonly error: string | null;
}

/** The minimal `balanceOf` surface, read-only. */
const BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/** A read-only viem client over the configured Arbitrum RPC. */
function createViemVoteChainReader(rpcUrl: string): VoteChainReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return {
    async readBalanceOf({ collection, account, blockNumber }) {
      const raw = await client.readContract({
        address: getAddress(collection),
        abi: BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [getAddress(account) as Address],
        blockNumber: BigInt(blockNumber),
      });
      if (typeof raw !== 'bigint') {
        throw new Error('balanceOf returned a value that is not an integer.');
      }
      return raw;
    },
  };
}

/**
 * Build the real adapter from the environment.
 *
 * When `ARBITRUM_RPC_URL` is unset the chain reader refuses every read, so
 * eligibility is never assumed without a configured endpoint. The hub is public
 * and needs no key.
 */
export function createServerVoteAdapter(): SnapshotAdapter {
  const hub = createSnapshotHubClient({ fetch: globalThis.fetch });
  const rpcUrl = readRpcUrlForChain(VOTE_CHAIN_ID);
  const chain: VoteChainReader =
    rpcUrl === null
      ? {
          async readBalanceOf() {
            throw new Error(
              `No RPC endpoint is configured for chain ${VOTE_CHAIN_ID} (ARBITRUM_RPC_URL).`,
            );
          },
        }
      : createViemVoteChainReader(rpcUrl);
  return createRealSnapshotAdapter({ hub, chain });
}

/**
 * Load the proposals for `spaceIds` and, when a wallet is connected, one voting
 * power read per proposal. A failure anywhere is returned as `error` rather than
 * thrown, so the page degrades honestly instead of crashing.
 */
export async function loadVoteData(input: {
  readonly wallet: string | null;
  readonly spaceIds: readonly string[];
}): Promise<VoteData> {
  const adapter = createServerVoteAdapter();
  try {
    const proposals = (
      await Promise.all(input.spaceIds.map((spaceId) => adapter.listProposals(spaceId)))
    ).flat();
    const powers: Record<string, VotingPowerRead> = {};
    if (input.wallet !== null) {
      for (const proposal of proposals) {
        powers[proposal.proposalId] = await adapter.readVotingPower({
          spaceId: proposal.spaceId,
          proposalId: proposal.proposalId,
          wallet: input.wallet,
          blockNumber: proposal.snapshotBlock,
        });
      }
    }
    return { proposals, powers, error: null };
  } catch (cause) {
    return {
      proposals: [],
      powers: {},
      error: cause instanceof Error ? cause.message : 'The Snapshot read failed.',
    };
  }
}
