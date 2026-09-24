/**
 * Self `verification.completed` → verification-outcome row, as a pure map.
 *
 * D16 / EXE-012, as amended (week-2 contract v1.7). Identity is verified **on
 * chain** by Self's own contract on Celo Sepolia; a verified resident receives
 * a soulbound token from Self. Kade does **not** mint an attestation, does
 * **not** emit `kade.kyc.v1`, and does **not** store nationality or expiry.
 * This module turns the signed webhook into the smallest honest outcome the
 * residency checks need: `valid` or `invalid`.
 *
 * **No SDK import, no Supabase, no `process.env`.** The Self SDK is only reached
 * from `./self`; the writer lives in
 * `supabase/migrations/20260924000002_self_verification_store.sql`. This file is
 * the whole policy: what may become a row, and what must be ignored.
 *
 * Safety rules, stated once:
 *   - only the `verification.completed` event is read;
 *   - a status that is neither `valid` nor `invalid` is ignored (a pending or
 *     error state is not an outcome and must never be recorded as one);
 *   - `external_uuid` must be a profile uuid, or the event is ignored;
 *   - the `verification_id` dedupe key is required: without it an at-least-once
 *     redelivery would be indistinguishable from a first delivery;
 *   - the `nullifier` is optional. It is Self's per-person identifier, kept for
 *     Sybil resistance when present; a valid result without one is still an
 *     outcome, so it does not block the row;
 *   - **fail closed**: a `valid` event is downgraded to `invalid` when the flow
 *     explicitly reports a predicate that did not hold (`ofac: false`, or a
 *     minimum age below 18). When the predicates are not disclosed as
 *     attributes, `valid` itself is the flow's pass/fail result — the Self flow
 *     is configured with Minimum age ≥18 and OFAC, so a `valid` result means
 *     both held (contract v1.7). An outcome that is not `valid` never yields a
 *     `valid` row.
 */

/** The only event type this module records. */
export const VERIFICATION_COMPLETED = 'verification.completed';

/** The minimum age the Kade residency flow requires. */
export const KADE_MINIMUM_AGE = 18;

/**
 * The subset of the Self webhook event this module reads.
 *
 * The SDK types the event exactly; this structural shape keeps the mapper
 * testable without importing the SDK, and tolerant of the `unknown` values in
 * `proof_attributes`.
 */
export interface SelfWebhookEventLike {
  readonly type?: string;
  readonly status?: string;
  readonly verification_id?: unknown;
  readonly external_uuid?: unknown;
  readonly nullifier?: unknown;
  readonly session_id?: unknown;
  readonly proof_attributes?: unknown;
  readonly [key: string]: unknown;
}

export type SelfVerificationStatus = 'valid' | 'invalid';

/** The mapped outcome: exactly the columns the writer stores. */
export interface MappedSelfVerification {
  /** `self_verifications.profile_id`, from `external_uuid`. */
  readonly profileId: string;
  readonly status: SelfVerificationStatus;
  /** The at-least-once delivery dedupe key; never empty. */
  readonly verificationId: string;
  /** Self's per-person identifier, when supplied. */
  readonly selfNullifier: string | null;
  /** The Self session id, when supplied. */
  readonly sessionId: string | null;
}

/** A result that must not be recorded, with the reason (safe to log). */
export interface IgnoredSelfEvent {
  readonly ignored: string;
}

export type SelfEventMapResult = MappedSelfVerification | IgnoredSelfEvent;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Whether the age predicate is affirmatively satisfied.
 *
 * `minimumAge` is accepted as the numeric threshold the flow checked (`>= 18`)
 * or as boolean `true`. A missing, false, malformed or sub-18 value is **not** a
 * pass. Absence is handled by the caller: when the flow does not disclose the
 * predicate, `valid` is the flow's own pass/fail result.
 */
export function isOver18(minimumAge: unknown): boolean {
  if (typeof minimumAge === 'number') {
    return Number.isFinite(minimumAge) && minimumAge >= KADE_MINIMUM_AGE;
  }
  return minimumAge === true;
}

/**
 * Whether the OFAC predicate is affirmatively satisfied. Only `true` passes; a
 * missing or false value does not.
 */
export function isNotSanctioned(ofac: unknown): boolean {
  return ofac === true;
}

/**
 * Whether the flow explicitly reports a predicate that did not hold.
 *
 * Only an explicitly present-and-negative predicate downgrades a `valid` event.
 * An undisclosed predicate is not a failure here: the flow configuration is the
 * authority and `valid` is its pass/fail result (contract v1.7).
 */
function predicatesFailed(attributes: Record<string, unknown>): boolean {
  if ('minimumAge' in attributes && !isOver18(attributes.minimumAge)) {
    return true;
  }
  if ('ofac' in attributes && !isNotSanctioned(attributes.ofac)) {
    return true;
  }
  return false;
}

/**
 * Map a verified Self event to a verification-outcome row, or ignore it.
 *
 * Returns `{ ignored }` rather than throwing, so the webhook route can
 * acknowledge a malformed or irrelevant event with a 2xx and no write.
 */
export function mapSelfEvent(event: SelfWebhookEventLike): SelfEventMapResult {
  if (!isRecord(event)) {
    return { ignored: 'the event is not an object' };
  }

  if (event.type !== undefined && event.type !== VERIFICATION_COMPLETED) {
    return { ignored: `unsupported event type: ${String(event.type)}` };
  }

  const status = nonEmptyString(event.status);
  if (status !== 'valid' && status !== 'invalid') {
    return {
      ignored: `status "${String(event.status)}" is not a completed outcome`,
    };
  }

  const externalUuid = nonEmptyString(event.external_uuid);
  if (externalUuid === null || !UUID_PATTERN.test(externalUuid)) {
    return { ignored: 'external_uuid is not a profile uuid' };
  }

  const verificationId =
    nonEmptyString(event.verification_id) ??
    nonEmptyString(event.id) ??
    nonEmptyString(event.session_id);
  if (verificationId === null) {
    return { ignored: 'a completed event carries no verification_id to dedupe on' };
  }

  const attributes = isRecord(event.proof_attributes)
    ? event.proof_attributes
    : {};

  // Fail closed: a `valid` event whose disclosed predicates explicitly failed is
  // recorded as `invalid`, never as a pass.
  const resolvedStatus: SelfVerificationStatus =
    status === 'valid' && predicatesFailed(attributes) ? 'invalid' : status;

  return {
    profileId: externalUuid.toLowerCase(),
    status: resolvedStatus,
    verificationId,
    selfNullifier: nonEmptyString(event.nullifier),
    sessionId: nonEmptyString(event.session_id),
  };
}
