/**
 * The Snapshot hub GraphQL client.
 *
 * The hub is a **read** source: this module only ever POSTs a query. It never
 * sends a vote, creates a proposal, or mutates a space. The `fetch` used is
 * injected so tests can supply a fake hub response and never dial the network.
 *
 * This client returns the hub's raw proposal shape; mapping it onto the Vote
 * primitives (and attaching the space's category) is the adapter's job.
 */

/** The public Snapshot hub endpoint. */
export const SNAPSHOT_HUB_URL = 'https://hub.snapshot.org/graphql';

/** The fields read from each proposal. */
export interface HubProposal {
  readonly id: string;
  readonly title: string;
  /** The hub's state (`pending` | `active` | `closed`), left unmapped here. */
  readonly state: string;
  /** The proposal window, in unix seconds. */
  readonly start: number;
  readonly end: number;
  /** The block the voting power is read at. */
  readonly snapshot: number;
  readonly space: { readonly id: string; readonly name: string };
  readonly choices: readonly string[];
  /**
   * The proposal description. `undefined` when the hub did not report one; an
   * empty string when the hub reports the proposal has none.
   */
  readonly body: string | undefined;
  /** The vote type (`basic`, `single-choice`, `weighted`, …). */
  readonly type: string | undefined;
  /** Per-choice totals, aligned with `choices`. */
  readonly scores: readonly number[] | undefined;
  /** The sum of `scores`; zero means no votes. */
  readonly scoresTotal: number | undefined;
  /** The number of votes cast. */
  readonly votes: number | undefined;
  /** The quorum the proposal requires. */
  readonly quorum: number | undefined;
}

/** The narrow hub surface the adapter depends on. */
export interface SnapshotHubClient {
  fetchProposals(spaceIds: readonly string[]): Promise<readonly HubProposal[]>;
}

export interface SnapshotHubClientDeps {
  /** Injected so a test can answer from a fixture. */
  readonly fetch: typeof fetch;
  /** Override the endpoint; defaults to {@link SNAPSHOT_HUB_URL}. */
  readonly endpoint?: string;
}

const PROPOSALS_QUERY = `query Proposals($spaces: [String!]!) {
  proposals(
    first: 50
    where: { space_in: $spaces }
    orderBy: "created"
    orderDirection: desc
  ) {
    id
    title
    state
    start
    end
    snapshot
    choices
    body
    type
    scores
    scores_total
    votes
    quorum
    space { id name }
  }
}`;

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A string field, or `undefined` when the hub did not report one. */
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A finite number, or `undefined` when the hub did not report one. */
function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** An array of finite numbers, or `undefined` when the hub did not report one. */
function optionalNumberArray(value: unknown): readonly number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every(
    (entry): entry is number => typeof entry === 'number' && Number.isFinite(entry),
  )
    ? value
    : undefined;
}

/**
 * The hub's `body` field: a string when reported, an empty string when the
 * proposal has no description (the hub reports that as `null`), and `undefined`
 * when the field was genuinely absent.
 */
function parseBody(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value === null) return '';
  return undefined;
}

function parseHubProposal(raw: unknown): HubProposal {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('The Snapshot hub returned a proposal that is not an object.');
  }
  const record = raw as Record<string, unknown>;
  const space = record.space as Record<string, unknown> | null | undefined;
  const choices = Array.isArray(record.choices)
    ? record.choices.filter((choice): choice is string => typeof choice === 'string')
    : null;

  if (
    typeof record.id !== 'string' ||
    typeof record.title !== 'string' ||
    typeof record.state !== 'string' ||
    typeof record.start !== 'number' ||
    typeof record.end !== 'number' ||
    typeof record.snapshot !== 'number' ||
    typeof space?.id !== 'string' ||
    choices === null
  ) {
    throw new Error(
      `The Snapshot hub returned a proposal missing required fields (id ${String(
        record.id,
      )}).`,
    );
  }

  return {
    id: record.id,
    title: record.title,
    state: record.state,
    start: record.start,
    end: record.end,
    snapshot: record.snapshot,
    space: {
      id: space.id,
      name: typeof space.name === 'string' ? space.name : space.id,
    },
    choices,
    body: parseBody(record.body),
    type: optionalString(record.type),
    scores: optionalNumberArray(record.scores),
    scoresTotal: optionalNumber(record.scores_total),
    votes: optionalNumber(record.votes),
    quorum: optionalNumber(record.quorum),
  };
}

function parseProposalsResponse(body: unknown): readonly HubProposal[] {
  if (typeof body !== 'object' || body === null) {
    throw new Error('The Snapshot hub returned a response that is not an object.');
  }
  const { errors, data } = body as { errors?: unknown; data?: unknown };
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as { message?: unknown } | undefined;
    throw new Error(
      `The Snapshot hub rejected the query: ${
        typeof first?.message === 'string' ? first.message : 'unknown error'
      }`,
    );
  }
  const proposals = (data as { proposals?: unknown } | undefined)?.proposals;
  if (!Array.isArray(proposals)) {
    throw new Error('The Snapshot hub returned no proposals array.');
  }
  return proposals.map(parseHubProposal);
}

/** Build a read-only hub client over the injected `fetch`. */
export function createSnapshotHubClient(
  deps: SnapshotHubClientDeps,
): SnapshotHubClient {
  const endpoint = deps.endpoint ?? SNAPSHOT_HUB_URL;
  return {
    async fetchProposals(spaceIds) {
      let response: Response;
      try {
        response = await deps.fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            query: PROPOSALS_QUERY,
            variables: { spaces: [...spaceIds] },
          }),
        });
      } catch (cause) {
        throw new Error(`The Snapshot hub could not be reached: ${describe(cause)}`);
      }
      if (!response.ok) {
        throw new Error(`The Snapshot hub responded ${response.status}.`);
      }
      const body: unknown = await response.json();
      return parseProposalsResponse(body);
    },
  };
}

/**
 * The read-only "has this voter already voted on this proposal?" surface.
 *
 * Snapshot rejects a duplicate vote itself, but the vote path should not try to
 * cast one: before it signs anything it asks the hub whether the voter already
 * has a vote on the proposal. This is a **read** — it never writes to Snapshot.
 */
export interface SnapshotVoteLookup {
  hasVoted(input: {
    readonly proposal: string;
    readonly voter: string;
  }): Promise<boolean>;
}

const VOTER_VOTE_QUERY = `query VoterVote($proposal: String!, $voter: String!) {
  votes(first: 1, where: { proposal: $proposal, voter: $voter }) {
    id
  }
}`;

/**
 * Build a read-only vote lookup over the injected `fetch`.
 *
 * A hub error is thrown, never collapsed into "no vote": the caller fails closed
 * rather than signing a vote it could not check for a duplicate.
 */
export function createSnapshotVoteLookup(
  deps: SnapshotHubClientDeps,
): SnapshotVoteLookup {
  const endpoint = deps.endpoint ?? SNAPSHOT_HUB_URL;
  return {
    async hasVoted({ proposal, voter }) {
      let response: Response;
      try {
        response = await deps.fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            query: VOTER_VOTE_QUERY,
            variables: { proposal, voter },
          }),
        });
      } catch (cause) {
        throw new Error(`The Snapshot hub could not be reached: ${describe(cause)}`);
      }
      if (!response.ok) {
        throw new Error(`The Snapshot hub responded ${response.status}.`);
      }
      const body: unknown = await response.json();
      if (typeof body !== 'object' || body === null) {
        throw new Error('The Snapshot hub returned a response that is not an object.');
      }
      const { errors, data } = body as { errors?: unknown; data?: unknown };
      if (Array.isArray(errors) && errors.length > 0) {
        const first = errors[0] as { message?: unknown } | undefined;
        throw new Error(
          `The Snapshot hub rejected the query: ${
            typeof first?.message === 'string' ? first.message : 'unknown error'
          }`,
        );
      }
      const votes = (data as { votes?: unknown } | undefined)?.votes;
      if (!Array.isArray(votes)) {
        throw new Error('The Snapshot hub returned no votes array.');
      }
      return votes.length > 0;
    },
  };
}
