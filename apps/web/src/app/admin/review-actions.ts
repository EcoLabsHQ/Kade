'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  AttestationIssuanceGatedError,
  isReviewAction,
  issueReviewAttestation,
  type ReviewAction,
} from '@/lib/review/attestation';
import type { ApplicationStatus } from '@/lib/review/decision';
import { InvalidReviewError, NotAReviewerError } from '@/lib/review/errors';

/**
 * The reviewer's write path (D19).
 *
 * The only write is an INSERT into `public.review_events`. The existing
 * `review_events_apply` trigger flips `applications.status`; this module never
 * updates that column, and `authenticated` has no privilege to do so. RLS is the
 * real gate (the insert policy requires `is_reviewer() and reviewer_id =
 * auth.uid()`); the explicit reviewer check below exists so a non-reviewer gets a
 * clear refusal instead of a raw policy error, not as a replacement for RLS.
 *
 * The `kade.review.v1` write is gated. The action still records the review in
 * `review_events` — the DB path is real — but leaves `attestation_uid` NULL when
 * issuance is refused, rather than inventing a UID.
 */

export interface SubmitReviewInput {
  readonly applicationId: string;
  readonly action: ReviewAction;
  readonly note?: string | null;
}

export interface SubmitReviewResult {
  readonly reviewEventId: number;
  /** `blocked` when the on-chain issuance gate refused the write. */
  readonly attestation: 'issued' | 'blocked';
  readonly attestationUid: string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function submitReview(
  input: SubmitReviewInput,
): Promise<SubmitReviewResult> {
  if (!input || typeof input.applicationId !== 'string' || !UUID_PATTERN.test(input.applicationId)) {
    throw new InvalidReviewError('A valid application id is required.');
  }
  if (!isReviewAction(input.action)) {
    throw new InvalidReviewError(
      'The action must be one of approve, block or reopen.',
    );
  }
  const note = input.note?.trim() ? input.note.trim() : null;
  if (note && note.length > 2000) {
    throw new InvalidReviewError('The note must be 2000 characters or fewer.');
  }

  const client = await createSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) {
    throw new Error('Submitting a review requires a signed-in session.');
  }

  // Explicit role check for a clear error; RLS enforces the same rule.
  const { data: reviewer, error: reviewerError } = await client
    .from('reviewers')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (reviewerError) {
    throw new Error(`Checking the reviewer role failed: ${reviewerError.message}`);
  }
  if (!reviewer) {
    throw new NotAReviewerError();
  }

  const { data: application, error: applicationError } = await client
    .from('applications')
    .select('id, ref')
    .eq('id', input.applicationId)
    .maybeSingle();
  if (applicationError) {
    throw new Error(`Loading the application failed: ${applicationError.message}`);
  }
  if (!application) {
    throw new InvalidReviewError('The application does not exist.');
  }

  const applicationRef =
    (application as { ref: string | null }).ref ?? input.applicationId;

  // The chain write is gated. Encode the payload (so the exact bytes exist) and
  // record the review without a UID rather than fabricate one.
  let attestationUid: string | null = null;
  let attestation: 'issued' | 'blocked' = 'blocked';
  try {
    const issued = issueReviewAttestation(applicationRef, input.action, note);
    attestationUid = issued.uid;
    attestation = 'issued';
  } catch (cause) {
    if (!(cause instanceof AttestationIssuanceGatedError)) throw cause;
  }

  const { data: inserted, error: insertError } = await client
    .from('review_events')
    .insert({
      application_id: input.applicationId,
      reviewer_id: user.id,
      action: input.action,
      note,
      attestation_uid: attestationUid,
    })
    .select('id')
    .single();
  if (insertError) {
    throw new Error(`Recording the review failed: ${insertError.message}`);
  }

  revalidatePath('/admin');

  return {
    reviewEventId: (inserted as { id: number }).id,
    attestation,
    attestationUid,
  };
}

export interface ReviewApplicationStatus {
  readonly status: ApplicationStatus | null;
}

/**
 * Read the current status after an action, for the caller to display. RLS scopes
 * it to an application the reviewer may see.
 */
export async function readApplicationStatus(
  applicationId: string,
): Promise<ReviewApplicationStatus> {
  if (!UUID_PATTERN.test(applicationId)) {
    throw new InvalidReviewError('A valid application id is required.');
  }
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from('applications')
    .select('status')
    .eq('id', applicationId)
    .maybeSingle();
  if (error) {
    throw new Error(`Reading the application status failed: ${error.message}`);
  }
  return { status: (data as { status: ApplicationStatus } | null)?.status ?? null };
}
