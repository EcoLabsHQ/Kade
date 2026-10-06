/**
 * Snapshot voting primitives.
 *
 * These types are the contract between the Vote screen and a Snapshot source.
 * The real Snapshot integration is **mocked** for now (see `./adapter`), but the
 * primitives are defined here so the real thing can be swapped in without
 * touching callers: the screen depends on this shape, never on the mock.
 *
 * The model follows the programme's spec:
 *   - a proposal belongs to a **space**, which carries a required **category**
 *     (`resident` or `citizen`);
 *   - voting power is `balanceOf(wallet)` of the relevant credential at the
 *     proposal's `snapshotBlock`;
 *   - power must be `> 0` to participate.
 *
 * The UI block that renders an eligibility decision is a companion to the real
 * rule, never the protection: the protection is the membership/credential state
 * on chain, checked by the contract and (later) the Snapshot strategy. The
 * screen must never be treated as the thing that stops an ineligible vote.
 */

/** The two credential categories the programme votes with. */
export type VoteCategory = 'resident' | 'citizen';

/**
 * A Snapshot space.
 *
 * `created: false` records that the space does not exist on Snapshot yet; it is
 * configuration for a space the programme has not created, not a claim that it
 * is live.
 */
export interface VoteSpace {
  readonly id: string;
  readonly name: string;
  /** The credential the space's proposals require. */
  readonly category: VoteCategory;
  /** Whether the space exists on Snapshot. The two spec spaces are not created. */
  readonly created: false;
}

/** One selectable option on a proposal. */
export interface VoteChoice {
  readonly id: string;
  readonly label: string;
}

/** Whether a proposal accepts votes. */
export type VoteProposalState = 'open' | 'closed';

/** Where a proposal record came from. `mock` is never presented as real. */
export type VoteProvenance = 'mock' | 'snapshot';

/**
 * A proposal, carrying the three fields the spec requires on every card:
 * `spaceId`, `proposalId` and the required `category`.
 */
export interface VoteProposal {
  readonly spaceId: string;
  readonly proposalId: string;
  readonly title: string;
  readonly category: VoteCategory;
  readonly state: VoteProposalState;
  /**
   * The block the voting power is read at. The real adapter resolves this from
   * the proposal; the mock adapter carries the reference's demo block.
   */
  readonly snapshotBlock: number;
  readonly choices: readonly VoteChoice[];
  readonly provenance: VoteProvenance;
}

/**
 * A voting-power read.
 *
 * `unknown` and `error` are deliberately distinct from a known zero: an
 * unreadable chain state must never be collapsed into "no membership" or "no
 * power". `error` is a read that was attempted and failed; `unknown` is a source
 * that could not answer at all (for example the mock).
 */
export type VotingPowerRead =
  | {
      readonly status: 'known';
      readonly power: bigint;
      readonly blockNumber: number;
      readonly provenance: VoteProvenance;
    }
  | { readonly status: 'unknown'; readonly reason: string }
  | { readonly status: 'error'; readonly reason: string };
