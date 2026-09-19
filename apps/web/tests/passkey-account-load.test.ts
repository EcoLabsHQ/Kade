import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * `loadPasskeyCredential` is the read behind `/account` and `/onboarding`.
 *
 * If it throws, the account page's unguarded `await` becomes a 500. These tests
 * pin the contract instead: a read failure returns null so the page renders a
 * usable "create" state. A duplicate row (there is no unique constraint on
 * `profile_id`) is just one such failure, not a special case.
 */

const hoisted = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: hoisted.createSupabaseServerClient,
}));

vi.mock('@/lib/env', () => ({
  isAuthConfigured: () => true,
  readAuthEnv: () => ({
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon-key',
    siteUrl: 'http://localhost:3000',
    callbackPath: '/auth/callback',
  }),
}));

import { loadPasskeyCredential } from '@/app/account/passkey-actions';

function clientWithCredentialResult(result: {
  data: unknown;
  error: { message: string } | null;
}): SupabaseClient {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.eq = () => builder;
  builder.maybeSingle = async () => result;
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: 'user-1' } }, error: null };
      },
    },
    from() {
      return builder;
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('loadPasskeyCredential degrades instead of throwing', () => {
  it('returns null when the credential read itself fails', async () => {
    hoisted.createSupabaseServerClient.mockResolvedValue(
      clientWithCredentialResult({
        data: null,
        error: { message: 'JSON object requested, multiple rows returned' },
      }),
    );

    await expect(loadPasskeyCredential()).resolves.toBeNull();
  });

  it('returns null when there are multiple rows, as a duplicate profile_id would produce', async () => {
    // No unique constraint on `profile_id` means `.maybeSingle()` errors when a
    // resident has more than one credential row. The read is not authoritative,
    // so it degrades to "none known".
    hoisted.createSupabaseServerClient.mockResolvedValue(
      clientWithCredentialResult({
        data: null,
        error: { message: 'multiple rows returned' },
      }),
    );

    await expect(loadPasskeyCredential()).resolves.toBeNull();
  });

  it('returns null when no session exists', async () => {
    const client = clientWithCredentialResult({ data: null, error: null });
    (client.auth.getUser as unknown) = async () => ({
      data: { user: null },
      error: null,
    });
    hoisted.createSupabaseServerClient.mockResolvedValue(client);

    await expect(loadPasskeyCredential()).resolves.toBeNull();
  });

  it('returns the stored credential on a successful read', async () => {
    hoisted.createSupabaseServerClient.mockResolvedValue(
      clientWithCredentialResult({
        data: {
          credential_id: 'cred-1',
          public_key: 'pk-1',
          signer_address: null,
          transports: ['internal'],
          user_verification: true,
          created_at: '2026-01-02T03:04:05.000Z',
          last_used_at: null,
        },
        error: null,
      }),
    );

    await expect(loadPasskeyCredential()).resolves.toEqual({
      credentialId: 'cred-1',
      publicKey: 'pk-1',
      signerAddress: null,
      transports: ['internal'],
      userVerification: true,
      createdAt: '2026-01-02T03:04:05.000Z',
      lastUsedAt: null,
    });
  });
});
