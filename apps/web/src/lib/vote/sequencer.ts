import type { SnapshotVoteTypedData } from './snapshot';

/**
 * The Snapshot **sequencer** client.
 *
 * `https://hub.snapshot.org/graphql` is read-only: a vote is not a GraphQL
 * mutation, it is an EIP-712 signed envelope POSTed to the sequencer at
 * `https://seq.snapshot.org`. This module owns that POST.
 *
 * The body is exactly what Snapshot's own `snapshot.js` client sends:
 *
 *   { address, sig, data: { domain, types, message } }
 *
 * `address` is the voter, `sig` is the signature (for a contract wallet, the
 * Safe's encoded owner signatures), and `data` is the typed data that was
 * signed. `primaryType` is deliberately omitted from the wire body: the
 * sequencer derives the primary type from `types`, and `snapshot.js` does not
 * send it.
 *
 * The `fetch` is injected so a test can answer from a fixture and never dial the
 * network. A non-2xx response, or a body the sequencer rejected, is returned as
 * an explicit failure carrying the sequencer's own message — never as success.
 */

/** The public Snapshot sequencer endpoint. */
export const SNAPSHOT_SEQUENCER_URL = 'https://seq.snapshot.org';

/** The typed data as it goes on the wire (no `primaryType`). */
export interface SnapshotVoteSignatureData {
  readonly domain: SnapshotVoteTypedData['domain'];
  readonly types: SnapshotVoteTypedData['types'];
  readonly message: SnapshotVoteTypedData['message'];
}

/** The envelope POSTed to the sequencer. */
export interface SnapshotVoteEnvelope {
  readonly address: string;
  readonly sig: string;
  readonly data: SnapshotVoteSignatureData;
}

/**
 * The sequencer's answer.
 *
 * `ok: true` means the sequencer **accepted** the vote; the identifiers are what
 * the sequencer returned, and are `null` when it did not report them. `ok:
 * false` carries the sequencer's own refusal. There is no third state.
 */
export type SnapshotSequencerResult =
  | {
      readonly ok: true;
      readonly id: string | null;
      readonly ipfsHash: string | null;
    }
  | { readonly ok: false; readonly reason: string };

/** The narrow sequencer surface the vote path depends on. */
export interface SnapshotSequencerClient {
  submitVote(envelope: SnapshotVoteEnvelope): Promise<SnapshotSequencerResult>;
}

export interface SnapshotSequencerClientDeps {
  /** Injected so a test can answer from a fixture. */
  readonly fetch: typeof fetch;
  /** Override the endpoint; defaults to {@link SNAPSHOT_SEQUENCER_URL}. */
  readonly endpoint?: string;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** The first reported error message from a sequencer body, or null. */
function sequencerError(body: unknown): string | null {
  if (typeof body === 'string' && body.trim() !== '') return body;
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const error = record.error;
  if (typeof error === 'string' && error.trim() !== '') return error;
  if (typeof error === 'object' && error !== null) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  if (typeof record.message === 'string' && record.message.trim() !== '') {
    return record.message;
  }
  return null;
}

/** A string field from the sequencer's success body, or null. */
function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Build a sequencer client over the injected `fetch`. */
export function createSnapshotSequencerClient(
  deps: SnapshotSequencerClientDeps,
): SnapshotSequencerClient {
  const endpoint = deps.endpoint ?? SNAPSHOT_SEQUENCER_URL;
  return {
    async submitVote(envelope) {
      let response: Response;
      try {
        response = await deps.fetch(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(envelope),
        });
      } catch (cause) {
        return {
          ok: false,
          reason: `The Snapshot sequencer could not be reached: ${describe(cause)}`,
        };
      }

      // The sequencer may answer with JSON (an error object or the receipt) or,
      // on some failures, with a non-JSON body. Read whichever is present
      // without assuming, so a rejection is never mistaken for success.
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (!response.ok) {
        const message = sequencerError(body);
        return {
          ok: false,
          reason:
            message !== null
              ? `The Snapshot sequencer rejected the vote (${response.status}): ${message}`
              : `The Snapshot sequencer rejected the vote (${response.status}).`,
        };
      }

      // A 2xx with an error body is still a refusal.
      const message = sequencerError(body);
      if (message !== null) {
        return {
          ok: false,
          reason: `The Snapshot sequencer rejected the vote: ${message}`,
        };
      }

      const record =
        typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>)
          : {};
      return {
        ok: true,
        id: optionalString(record.id),
        ipfsHash: optionalString(record.ipfs) ?? optionalString(record.ipfsHash),
      };
    },
  };
}
