import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Holdings server actions (`link-actions.ts`).
 *
 * This is the single point where front 04 consumes front 03's frozen ownership
 * interface. The regression this pins (review F1): the action must branch on
 * 03's real result shape `{ ok, error? }` — not the earlier assumed
 * `{ verifiedAt }` — and must relay 03's own error text. A verified proof is
 * `{ ok: true }`; anything else throws and must not revalidate the screen.
 */

const hoisted = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  revalidatePath: vi.fn(),
  issueOwnershipChallenge: vi.fn(),
  verifyWalletOwnership: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: hoisted.createSupabaseServerClient,
}));
vi.mock('next/cache', () => ({ revalidatePath: hoisted.revalidatePath }));
vi.mock('@/lib/wallet/ownership', () => ({
  issueOwnershipChallenge: hoisted.issueOwnershipChallenge,
  verifyWalletOwnership: hoisted.verifyWalletOwnership,
}));

import {
  beginWalletLink,
  completeWalletLink,
} from '@/app/holdings/link-actions';

const ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
const INPUT = {
  address: ADDRESS,
  message: 'kade.example wants you to sign in with your Ethereum account',
  signature: '0xsigned',
} as const;

function withSession(user: { id: string } | null): void {
  hoisted.createSupabaseServerClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('completeWalletLink', () => {
  it('relays a verified proof as ok and revalidates the Holdings screen', async () => {
    withSession({ id: 'resident-1' });
    hoisted.verifyWalletOwnership.mockResolvedValue({ ok: true });

    await expect(completeWalletLink(INPUT)).resolves.toEqual({ ok: true });

    expect(hoisted.verifyWalletOwnership).toHaveBeenCalledWith(INPUT);
    expect(hoisted.revalidatePath).toHaveBeenCalledWith('/holdings');
  });

  it("relays front 03's own error text and does not revalidate", async () => {
    withSession({ id: 'resident-1' });
    hoisted.verifyWalletOwnership.mockResolvedValue({
      ok: false,
      error: 'This challenge has expired.',
    });

    await expect(completeWalletLink(INPUT)).rejects.toThrow(
      'This challenge has expired.',
    );
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });

  it('still throws a clear error when 03 gives no detail', async () => {
    withSession({ id: 'resident-1' });
    hoisted.verifyWalletOwnership.mockResolvedValue({ ok: false });

    await expect(completeWalletLink(INPUT)).rejects.toThrow(
      /did not verify/i,
    );
  });

  it('refuses without a session before calling front 03', async () => {
    withSession(null);

    await expect(completeWalletLink(INPUT)).rejects.toThrow(
      /signed-in session/i,
    );
    expect(hoisted.verifyWalletOwnership).not.toHaveBeenCalled();
  });
});

describe('beginWalletLink', () => {
  it("returns front 03's challenge message for the connected address", async () => {
    withSession({ id: 'resident-1' });
    hoisted.issueOwnershipChallenge.mockResolvedValue({
      nonce: 'abc',
      message: 'sign me',
    });

    await expect(beginWalletLink(ADDRESS)).resolves.toEqual({
      message: 'sign me',
    });
    expect(hoisted.issueOwnershipChallenge).toHaveBeenCalledWith(ADDRESS);
  });

  it('refuses without a session before calling front 03', async () => {
    withSession(null);

    await expect(beginWalletLink(ADDRESS)).rejects.toThrow(/signed-in session/i);
    expect(hoisted.issueOwnershipChallenge).not.toHaveBeenCalled();
  });
});
