import { ISO_3166_ALPHA3_TO_ALPHA2 } from './iso-3166-alpha3';

/**
 * Self `verification.completed` → verification-outcome row, as a pure map.
 *
 * D16 / EXE-012. Self verifies the proof on its own servers (backend /
 * off-chain mode) and delivers the result by signed webhook; there is no wallet
 * step and no soulbound token. Because it is backend mode, the webhook also
 * carries the **disclosed facts** in `proof_attributes` (`nationality`,
 * `expiryDate`) where on-chain mode sent an empty `{}`. This module turns the
 * signed webhook into the row the residency checks store: the outcome
 * `valid`/`invalid` plus the disclosed identity facts.
 *
 * What is read:
 *   - the outcome (`status`) and the identifiers (`external_uuid`,
 *     `verification_id`, `nullifier`, `session_id`);
 *   - `proof_attributes.nationality` — Self sends ISO 3166-1 **alpha-3**
 *     (`NLD`) and the repository stores **alpha-2** (`NL`); an unknown code
 *     becomes `null`, never a guess;
 *   - `proof_attributes.expiryDate` — a passport MRZ `YYMMDD`, interpreted in
 *     the current century (`20YY`) and converted to an ISO date; an
 *     unparseable value becomes `null`, never an invented date;
 *   - `proof_attributes.minimumAge` / `.ofac` — the flow predicates, unchanged.
 *     `over18` and `notSanctioned` are derived from the resolved outcome: both
 *     true on `valid`, both false on `invalid`. Kade does **not** emit
 *     `kade.kyc.v1` here; the payload built from these facts is prepared and
 *     gated in `./kyc-attestation`.
 *
 * **No SDK import, no Supabase, no `process.env`.** The Self SDK is only reached
 * from `./self`; the writer lives in
 * `supabase/migrations/20260924000010_self_verification_facts.sql`. This file
 * is the whole policy: what may become a row, and what must be ignored.
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
 *   - a disclosed fact that cannot be read honestly (an unknown nationality
 *     code, an unparseable expiry) is stored as `null`: the outcome row is still
 *     written, and the missing fact is never guessed;
 *   - **fail closed**: a `valid` event is downgraded to `invalid` when the flow
 *     explicitly reports a predicate that did not hold (`ofac: false`, or a
 *     minimum age below 18), and the derived `over18`/`notSanctioned` follow the
 *     resolved outcome. When the predicates are not disclosed as attributes,
 *     `valid` itself is the flow's pass/fail result — the Self flow is
 *     configured with Minimum age ≥18 and OFAC, so a `valid` result means both
 *     held. An outcome that is not `valid` never yields a `valid` row.
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
  /**
   * The disclosed nationality as ISO 3166-1 **alpha-2** (`NL`), or `null` when
   * Self disclosed nothing or disclosed a code this repository does not know.
   */
  readonly nationality: string | null;
  /** The age predicate, from the resolved outcome: true only on `valid`. */
  readonly over18: boolean;
  /** The sanctions predicate, from the resolved outcome: true only on `valid`. */
  readonly notSanctioned: boolean;
  /** Passport expiry as an ISO date (`YYYY-MM-DD`), or `null` when unparseable. */
  readonly expiresAt: string | null;
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
 * Convert an ISO 3166-1 **alpha-3** code to the repository's **alpha-2**
 * convention, or `null`.
 *
 * The lookup is a frozen table (./iso-3166-alpha3), so an unknown or malformed
 * code returns `null` and is never guessed. Case and surrounding whitespace are
 * not significant.
 */
export function alpha3ToAlpha2(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return null;
  return ISO_3166_ALPHA3_TO_ALPHA2[code] ?? null;
}

/**
 * Convert a passport MRZ `YYMMDD` expiry to an ISO date, or `null`.
 *
 * Century handling: passport expiry is **current-century**, so the two-digit
 * year is read as `20YY` (the MRZ date is six digits; the `19YY` reading is not
 * possible for a document that is valid now). A value that is not exactly six
 * digits, or that names an impossible calendar day (month 13, 31 February), is
 * rejected as `null` rather than repaired into a nearby date.
 */
export function mrzDateToIso(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
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

  // The disclosed facts are read as-is; a code or date that cannot be read
  // honestly is `null`, so the outcome row is still written and nothing is
  // guessed. The predicates are derived from the *resolved* outcome, so a
  // downgraded `valid` yields `over18: false`, exactly like a Self-reported
  // `invalid`.
  const predicatesHeld = resolvedStatus === 'valid';

  return {
    profileId: externalUuid.toLowerCase(),
    status: resolvedStatus,
    verificationId,
    selfNullifier: nonEmptyString(event.nullifier),
    sessionId: nonEmptyString(event.session_id),
    nationality: alpha3ToAlpha2(attributes.nationality),
    over18: predicatesHeld,
    notSanctioned: predicatesHeld,
    expiresAt: mrzDateToIso(attributes.expiryDate),
  };
}
