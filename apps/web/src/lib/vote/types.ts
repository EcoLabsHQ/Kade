/**
 * Snapshot voting primitives.
 *
 * These types are the contract between the Vote screen and a Snapshot source.
 * A real Snapshot source now sits behind the adapter (see `./adapter`), and the
 * mock remains available for tests, but the primitives are defined here so both
 * satisfy the same shape: the screen depends on this shape, never on a source.
 *
 * The model follows the programme's spec:
 *   - a proposal belongs to a **space**, which carries a required **category**
 *     (`resident` or `citizen`);
 *   - voting power is `balanceOf(wallet)` of the space's credential(s) at the
 *     proposal's `snapshotBlock`;
 *   - power must be `> 0` to participate.
 *
 * The UI block that renders an eligibility decision is a companion to the real
 * rule, never the protection: the protection is the membership/credential state
 * on chain, checked by the contract and the Snapshot strategy. The screen must
 * never be treated as the thing that stops an ineligible vote.
 */

/** The two credential categories the programme votes with. */
export type VoteCategory = 'resident' | 'citizen';

/**
 * A credential collection whose `balanceOf` grants voting power.
 *
 * Both Colosseum collections are soulbound ERC-721s, but the rule is the same
 * `balanceOf(account)` read either way, so the same shape covers them.
 */
export interface VoteCredential {
  /** The collection address on `chainId`. */
  readonly address: `0x${string}`;
  /** The collection's symbol, for display and diagnostics. */
  readonly symbol: string;
}

/**
 * A Snapshot space.
 *
 * `created` records whether the space exists on Snapshot. Both programme spaces
 * now exist (`kadeglobal.eth` and `cwcitizen.eth`), so this is `true` for them;
 * a placeholder or a future space reports `false` rather than pretending to be
 * live.
 */
export interface VoteSpace {
  readonly id: string;
  readonly name: string;
  /** The credential the space's proposals require. */
  readonly category: VoteCategory;
  /** Whether the space exists on Snapshot. */
  readonly created: boolean;
}

/**
 * The committed configuration for a space: the {@link VoteSpace} plus the chain
 * and credential(s) its voting power is read from.
 *
 * This is configuration, not a title check: which space a proposal belongs to
 * decides which credential(s) count, and the mapping lives here.
 */
export interface VoteSpaceConfig extends VoteSpace {
  /** The chain the space's credential(s) live on. */
  readonly chainId: number;
  /**
   * The credential(s) that grant power in this space. A space open to both
   * residents and citizens lists both; a citizen-only space lists the Citizen
   * collection.
   */
  readonly credentials: readonly VoteCredential[];
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
  /** The proposal window, in unix seconds, when the source reports it. */
  readonly start?: number;
  readonly end?: number;
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
