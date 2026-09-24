import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Self webhook route (D16, contract v1.7).
 *
 * The SDK and the Supabase client are mocked at their boundaries, so the route
 * decisions are under test without a credential: the not-configured branch, the
 * 400/500 statuses, an unknown resident acknowledged with 2xx, duplicate
 * delivery, and the exact arguments handed to the privileged writer. The pure
 * mapper is real. The raw body is passed through untouched and no
 * `identity_attestations` write is ever made.
 */

const PROFILE = '11111111-1111-4111-8111-111111111111';

const hoisted = vi.hoisted(() => ({
  isSelfVerificationConfigured: vi.fn(),
  verifySelfWebhook: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  rpc: vi.fn(),
  ServiceRoleNotConfiguredError: class ServiceRoleNotConfiguredError extends Error {},
}));

vi.mock('@/lib/residency/self', () => ({
  isSelfVerificationConfigured: hoisted.isSelfVerificationConfigured,
  verifySelfWebhook: hoisted.verifySelfWebhook,
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: hoisted.createSupabaseServiceClient,
  ServiceRoleNotConfiguredError: hoisted.ServiceRoleNotConfiguredError,
}));

import { POST } from '@/app/api/webhooks/self/route';

interface DbOptions {
  readonly profile?: { id: string } | null;
  readonly existing?: { id: number } | null;
  readonly lookupError?: { message: string } | null;
  readonly rpcError?: { message: string } | null;
  readonly serviceRoleMissing?: boolean;
}

function configureDb(options: DbOptions = {}): void {
  hoisted.createSupabaseServiceClient.mockImplementation(async () => {
    if (options.serviceRoleMissing) {
      throw new hoisted.ServiceRoleNotConfiguredError(
        'SUPABASE_SERVICE_ROLE_KEY is not configured',
      );
    }
    return {
      from: (table: string) => {
        if (table !== 'profiles' && table !== 'self_verifications') {
          throw new Error(`unexpected table ${table}`);
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data:
                  table === 'profiles'
                    ? (options.profile ?? null)
                    : (options.existing ?? null),
                error: options.lookupError ?? null,
              }),
            }),
          }),
        };
      },
      rpc: hoisted.rpc,
    };
  });
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'verification.completed',
    status: 'valid',
    verification_id: 'ver_1',
    external_uuid: PROFILE,
    nullifier: 'nullifier-abc',
    proof_attributes: { minimumAge: true, ofac: true },
    ...overrides,
  };
}

function postRequest(body = '{"type":"verification.completed"}'): Request {
  return new Request('http://localhost/api/webhooks/self', {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'svix-id': 'msg_1',
      'svix-timestamp': '1700000000',
      'svix-signature': 'v1,abc',
    },
  });
}

beforeEach(() => {
  hoisted.isSelfVerificationConfigured.mockReturnValue(true);
  hoisted.verifySelfWebhook.mockResolvedValue({
    status: 'verified',
    event: validEvent(),
  });
  hoisted.rpc.mockResolvedValue({ data: null, error: null });
  configureDb({ profile: { id: PROFILE }, existing: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/webhooks/self', () => {
  it('reports not-configured without touching the SDK or the database', async () => {
    hoisted.isSelfVerificationConfigured.mockReturnValue(false);

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'not-configured',
      reason: 'Self webhook credentials are not configured.',
    });
    expect(hoisted.verifySelfWebhook).not.toHaveBeenCalled();
    expect(hoisted.createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('verifies against the raw body and the headers', async () => {
    await POST(postRequest('{"raw":"bytes"}'));

    expect(hoisted.verifySelfWebhook).toHaveBeenCalledTimes(1);
    expect(hoisted.verifySelfWebhook).toHaveBeenCalledWith(
      '{"raw":"bytes"}',
      expect.objectContaining({
        'svix-id': 'msg_1',
        'svix-signature': 'v1,abc',
      }),
    );
  });

  it('rejects a bad signature with 400 and writes nothing', async () => {
    hoisted.verifySelfWebhook.mockResolvedValue({ status: 'invalid-signature' });

    const response = await POST(postRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ status: 'invalid-signature' });
    expect(hoisted.createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('rejects an unparsable payload with 400', async () => {
    hoisted.verifySelfWebhook.mockResolvedValue({ status: 'invalid-payload' });

    const response = await POST(postRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ status: 'invalid-payload' });
  });

  it('answers 500 when the SDK is unavailable so the provider retries', async () => {
    hoisted.verifySelfWebhook.mockResolvedValue({
      status: 'unavailable',
      reason: 'SDK not installed',
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ status: 'unavailable' });
  });

  it('acknowledges an ignored event with 200 and no write', async () => {
    hoisted.verifySelfWebhook.mockResolvedValue({
      status: 'verified',
      event: validEvent({ status: 'pending' }),
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ignored');
    expect(hoisted.createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('acknowledges an unknown resident with 200 and no write', async () => {
    configureDb({ profile: null });

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ignored',
      reason: 'unknown resident',
    });
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it('absorbs a duplicate delivery without writing again', async () => {
    configureDb({ profile: { id: PROFILE }, existing: { id: 1 } });

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'duplicate' });
    expect(hoisted.rpc).not.toHaveBeenCalled();
  });

  it('records a valid outcome through the privileged writer', async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'recorded' });
    expect(hoisted.rpc).toHaveBeenCalledWith('record_self_verification', {
      p_profile_id: PROFILE,
      p_status: 'valid',
      p_verified_at: expect.any(String),
      p_self_nullifier: 'nullifier-abc',
      p_session_id: null,
      p_verification_id: 'ver_1',
      p_nationality: null,
      p_over18: true,
      p_not_sanctioned: true,
      p_expires_at: null,
    });
  });

  it('records an invalid outcome with no verification time', async () => {
    hoisted.verifySelfWebhook.mockResolvedValue({
      status: 'verified',
      event: validEvent({ status: 'invalid', nullifier: null }),
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'recorded' });
    expect(hoisted.rpc).toHaveBeenCalledWith('record_self_verification', {
      p_profile_id: PROFILE,
      p_status: 'invalid',
      p_verified_at: null,
      p_self_nullifier: null,
      p_session_id: null,
      p_verification_id: 'ver_1',
      p_nationality: null,
      p_over18: false,
      p_not_sanctioned: false,
      p_expires_at: null,
    });
  });

  it('answers 500 when the writer capability is absent', async () => {
    configureDb({ serviceRoleMissing: true });

    const response = await POST(postRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      status: 'unavailable',
      reason: 'writer not configured',
    });
  });

  it('answers 500 when the write fails so the provider retries', async () => {
    hoisted.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const response = await POST(postRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ status: 'error' });
  });
});
