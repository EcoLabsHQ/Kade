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
    space { id name }
  }
}`;

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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
