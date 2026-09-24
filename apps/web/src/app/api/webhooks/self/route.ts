import { NextResponse } from 'next/server';
import {
  isSelfVerificationConfigured,
  verifySelfWebhook,
} from '@/lib/residency/self';
import { mapSelfEvent } from '@/lib/residency/self-event';
import {
  createSupabaseServiceClient,
  ServiceRoleNotConfiguredError,
} from '@/lib/supabase/server';

/**
 * Self (self.xyz) webhook receiver (D16 / EXE-012).
 *
 * As amended (week-2 contract v1.7), Self verifies the passport proof on chain
 * (Celo Sepolia) and issues a soulbound token; this route records only the
 * **outcome** so the residency identity check can read it. It does not write
 * `identity_attestations` and does not emit `kade.kyc.v1`.
 *
 * The provider calls this server-to-server; it carries no resident session, so
 * it is a public path (`@/lib/routing`) and authenticates with the Svix
 * signature over the **raw** body. The route:
 *
 *   1. reports `not-configured` when the Self credentials are absent, without
 *      touching the SDK or fabricating a result (503);
 *   2. verifies the signature and maps the event with the pure mapper;
 *   3. resolves `external_uuid` to a profile and records the outcome through
 *      `record_self_verification`, a `SECURITY DEFINER` function granted only to
 *      `service_role` (the request has no `auth.uid()`);
 *   4. is idempotent: Self delivers at least once, so a repeated
 *      `verification_id` is absorbed by the UNIQUE key and the writer's
 *      `ON CONFLICT`.
 *
 * Status codes: 400 for a bad signature or unparsable payload (do not retry),
 * 500 for a transient/database failure (Self retries), 200 for anything that
 * was handled — including an unknown resident, which the dashboard's test
 * request will produce. The raw body and every secret are never logged.
 */

// The Self SDK is Node-only; the default Node runtime is required.
export const runtime = 'nodejs';
// A webhook must never be cached.
export const dynamic = 'force-dynamic';

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/**
 * Whether the resident a Self event names exists.
 *
 * `external_uuid` is the profile id supplied when the session was created. A
 * sample user from the dashboard's "Send Test Request" has no profile, so this
 * returns false and the caller acknowledges with 2xx rather than 5xx: an unknown
 * resident is not a server error, and treating it as one would make the endpoint
 * look broken to the person testing it.
 */
async function profileExists(profileId: string): Promise<boolean> {
  const client = await createSupabaseServiceClient();
  const { data, error } = await client
    .from('profiles')
    .select('id')
    .eq('id', profileId)
    .maybeSingle();
  if (error) throw new Error(`profile lookup failed: ${error.message}`);
  return data !== null;
}

/** Whether this verification_id has already been recorded (duplicate delivery). */
async function verificationExists(verificationId: string): Promise<boolean> {
  const client = await createSupabaseServiceClient();
  const { data, error } = await client
    .from('self_verifications')
    .select('id')
    .eq('verification_id', verificationId)
    .maybeSingle();
  if (error) throw new Error(`verification lookup failed: ${error.message}`);
  return data !== null;
}

/** Record the mapped outcome through the service-role-only writer. */
async function recordVerification(mapped: {
  readonly profileId: string;
  readonly status: 'valid' | 'invalid';
  readonly verificationId: string;
  readonly selfNullifier: string | null;
  readonly sessionId: string | null;
}): Promise<void> {
  const client = await createSupabaseServiceClient();
  const { error } = await client.rpc('record_self_verification', {
    p_profile_id: mapped.profileId,
    p_status: mapped.status,
    p_verified_at: mapped.status === 'valid' ? new Date().toISOString() : null,
    p_self_nullifier: mapped.selfNullifier,
    p_session_id: mapped.sessionId,
    p_verification_id: mapped.verificationId,
  });
  if (error) throw new Error(`recording the verification failed: ${error.message}`);
}

export async function POST(request: Request): Promise<Response> {
  if (!isSelfVerificationConfigured()) {
    return json(
      {
        status: 'not-configured',
        reason: 'Self webhook credentials are not configured.',
      },
      503,
    );
  }

  // The signature is over the exact bytes received, so the body is read as
  // text and never parsed first.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return json({ status: 'unreadable-body' }, 400);
  }

  const headers = Object.fromEntries(request.headers);
  const verification = await verifySelfWebhook(rawBody, headers);

  if (verification.status !== 'verified') {
    switch (verification.status) {
      case 'not-configured':
        return json({ status: 'not-configured' }, 503);
      case 'invalid-signature':
        return json({ status: 'invalid-signature' }, 400);
      case 'invalid-payload':
        return json({ status: 'invalid-payload' }, 400);
      case 'unavailable':
        console.error(
          '[kade] Self webhook verification was unavailable; the provider will retry.',
        );
        return json({ status: 'unavailable' }, 500);
    }
  }

  const mapped = mapSelfEvent(verification.event);
  if ('ignored' in mapped) {
    return json({ status: 'ignored', reason: mapped.ignored }, 200);
  }

  try {
    if (!(await profileExists(mapped.profileId))) {
      return json({ status: 'ignored', reason: 'unknown resident' }, 200);
    }

    // At-least-once delivery: a repeat of the same verification maps to the same
    // verification_id, so an existing row means nothing to do. The writer's
    // UNIQUE key is the race backstop.
    if (await verificationExists(mapped.verificationId)) {
      return json({ status: 'duplicate' }, 200);
    }

    await recordVerification(mapped);
    return json({ status: 'recorded' }, 200);
  } catch (cause) {
    if (cause instanceof ServiceRoleNotConfiguredError) {
      console.error(
        '[kade] Self webhook received but the service-role writer is not configured.',
      );
      return json({ status: 'unavailable', reason: 'writer not configured' }, 500);
    }
    console.error(
      '[kade] Self webhook write failed:',
      cause instanceof Error ? cause.message : 'unknown error',
    );
    return json({ status: 'error' }, 500);
  }
}
