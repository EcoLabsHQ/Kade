import { encodeAbiParameters, type AbiParameter } from 'viem';
import { EAS_SCHEMAS } from '@kade/shared';

/**
 * The review action, and the `kade.review.v1` issuance path.
 *
 * The action vocabulary is fixed by the database check constraint
 * (20260916000007_review_events.sql: `action in ('approve','block','reopen')`).
 * The schema is frozen in `@kade/shared` (packages/shared/src/eas.ts); this
 * module does not redefine it, it reads the field list and encodes against it so
 * the bytes cannot drift from the registered schema.
 *
 * The on-chain write is gated: the Onchain gate must approve irreversible
 * issuance before a `kade.review.v1` attestation is sent. `issueReviewAttestation`
 * therefore encodes the exact payload (so the path is reviewable and testable)
 * and then refuses to send, marking the boundary rather than fabricating a UID.
 */

export const REVIEW_ACTIONS = ['approve', 'block', 'reopen'] as const;

export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export function isReviewAction(value: unknown): value is ReviewAction {
  return (
    typeof value === 'string' &&
    (REVIEW_ACTIONS as readonly string[]).includes(value)
  );
}

/**
 * The `kade.review.v1` payload for an action.
 *
 * `cleared` is true only for `approve`. `block` and `reopen` both leave the
 * application uncleared: `block` records a refusal, `reopen` returns the
 * application to review, and neither is a clearance.
 */
export interface ReviewAttestationData {
  readonly applicationRef: string;
  readonly cleared: boolean;
  readonly note: string;
}

export function reviewAttestationData(
  applicationRef: string,
  action: ReviewAction,
  note: string | null,
): ReviewAttestationData {
  return {
    applicationRef,
    cleared: action === 'approve',
    note: note ?? '',
  };
}

/**
 * Encode the payload against the frozen `kade.review.v1` field list. Field order
 * comes from the shared schema, which is the order that determines the
 * registered UID, so the encoder cannot silently reorder the tuple.
 */
export function encodeReviewAttestation(
  data: ReviewAttestationData,
): `0x${string}` {
  const definition = EAS_SCHEMAS['kade.review.v1'];
  const parameters: AbiParameter[] = definition.fields.map((field) => ({
    name: field.name,
    type: field.type,
  }));
  return encodeAbiParameters(parameters, [
    data.applicationRef,
    data.cleared,
    data.note,
  ]);
}

/**
 * Raised when the on-chain `kade.review.v1` write is attempted before the
 * Onchain gate has approved irreversible issuance.
 *
 * This is the honest boundary required by the Week 2 contract: the DB path
 * (`review_events` -> status trigger) is real and runs, the chain write is not
 * performed and no attestation UID is invented.
 */
export class AttestationIssuanceGatedError extends Error {
  constructor(
    message = 'kade.review.v1 issuance is gated: the Onchain gate has not ' +
      'approved irreversible attestation writes. The review was recorded in ' +
      'review_events with no attestation UID.',
  ) {
    super(message);
    this.name = 'AttestationIssuanceGatedError';
  }
}

export interface IssuedReviewAttestation {
  readonly uid: string;
  readonly txHash: string;
}

/**
 * Issue a `kade.review.v1` attestation for a review.
 *
 * The repository contains no EAS broadcast path (registration was sent from
 * outside it), and the Onchain gate has not approved issuance, so this encodes
 * the payload and refuses. The caller records the review in `review_events`
 * regardless; only the UID is withheld.
 *
 * @throws {AttestationIssuanceGatedError} always, until the gate is approved.
 */
export function issueReviewAttestation(
  applicationRef: string,
  action: ReviewAction,
  note: string | null,
): IssuedReviewAttestation {
  // Encode so the exact bytes the gate must approve exist and are testable.
  encodeReviewAttestation(reviewAttestationData(applicationRef, action, note));
  throw new AttestationIssuanceGatedError();
}
