import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { OnboardingSnapshot } from '@/lib/onboarding/persistence';

/**
 * The onboarding page's server-side wiring.
 *
 * D3's "survives reload" is only observable if the page asks the persistence
 * layer what the resident already has before choosing a starting step. These
 * tests pin that: a stored credential id is read and handed to the flow, so a
 * returning resident is recognised rather than asked to enrol again.
 */

const hoisted = vi.hoisted(() => ({
  redirect: vi.fn(),
  getSessionUser: vi.fn(),
  loadOnboardingSnapshot: vi.fn(),
  resolvePreapprovalFeeBreakdown: vi.fn(),
  loadPasskeyCredential: vi.fn(),
  listBitcoinAddresses: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: hoisted.redirect }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
}));
vi.mock('@/lib/onboarding/server', () => ({
  loadOnboardingSnapshot: hoisted.loadOnboardingSnapshot,
}));
vi.mock('@/lib/onboarding/fee-server', () => ({
  resolvePreapprovalFeeBreakdown: hoisted.resolvePreapprovalFeeBreakdown,
}));
vi.mock('@/app/account/passkey-actions', () => ({
  loadPasskeyCredential: hoisted.loadPasskeyCredential,
}));
vi.mock('@/app/onboarding/actions', () => ({
  previewPreapprovalFee: vi.fn(),
  saveOnboardingStep2: vi.fn(),
}));
vi.mock('@/app/onboarding/wealth-actions', () => ({
  listBitcoinAddresses: hoisted.listBitcoinAddresses,
  addBitcoinAddress: vi.fn(),
  removeBitcoinAddress: vi.fn(),
}));
vi.mock('@/lib/env', () => ({
  isAuthConfigured: () => true,
  readAuthEnv: () => ({
    supabaseUrl: 'http://127.0.0.1:54321',
    supabaseAnonKey: 'anon-key',
    siteUrl: 'http://localhost:3000',
    callbackPath: '/auth/callback',
  }),
  readChainEnv: () => 'testnet',
  readFeeMode: () => 'demo',
}));

import OnboardingPage from '@/app/onboarding/page';

interface FlowProps {
  readonly initialCredentialId?: string | null;
  readonly initial?: OnboardingSnapshot | null;
  readonly initialBitcoinAddresses?: readonly {
    readonly id: number;
    readonly address: string;
  }[];
}

async function flowProps(): Promise<FlowProps> {
  const element = (await OnboardingPage()) as ReactElement<FlowProps>;
  return element.props;
}

beforeEach(() => {
  hoisted.getSessionUser.mockResolvedValue({
    userId: 'user-1',
    email: 'resident@example.com',
    provider: 'email',
  });
  hoisted.loadOnboardingSnapshot.mockResolvedValue(null);
  hoisted.resolvePreapprovalFeeBreakdown.mockResolvedValue(null);
  hoisted.loadPasskeyCredential.mockResolvedValue(null);
  hoisted.listBitcoinAddresses.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('onboarding page credential restore', () => {
  it('hands the stored credential id to the flow, so a returning resident skips enrolment', async () => {
    hoisted.loadPasskeyCredential.mockResolvedValue({
      credentialId: 'cred-existing',
      publicKey: 'pk',
      signerAddress: null,
      transports: ['internal'],
      userVerification: true,
      createdAt: '2026-09-18T00:00:00Z',
      lastUsedAt: null,
    });

    expect((await flowProps()).initialCredentialId).toBe('cred-existing');
  });

  it('hands null when the resident has no stored credential', async () => {
    expect((await flowProps()).initialCredentialId).toBeNull();
  });

  it('degrades to the create state when the credential read fails', async () => {
    hoisted.loadPasskeyCredential.mockRejectedValue(new Error('database down'));

    expect((await flowProps()).initialCredentialId).toBeNull();
  });

  it('hands the restored Bitcoin addresses to the flow', async () => {
    hoisted.listBitcoinAddresses.mockResolvedValue([
      {
        id: 7,
        address: 'bc1qexampleexampleexampleexampleexampleexample0',
        btc: '0.50000000',
        usd: 25000,
        readAt: '2026-09-21T00:00:00Z',
        readError: null,
      },
    ]);

    const props = await flowProps();
    expect(props.initialBitcoinAddresses).toHaveLength(1);
    expect(props.initialBitcoinAddresses?.[0]?.address).toMatch(/^bc1q/);
  });

  it('degrades to no addresses when the Bitcoin read fails', async () => {
    hoisted.listBitcoinAddresses.mockRejectedValue(new Error('provider down'));

    expect((await flowProps()).initialBitcoinAddresses).toEqual([]);
  });

  it('redirects to login when there is no session', async () => {
    hoisted.getSessionUser.mockResolvedValue(null);
    hoisted.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });

    await expect(OnboardingPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(hoisted.loadPasskeyCredential).not.toHaveBeenCalled();
  });
});
