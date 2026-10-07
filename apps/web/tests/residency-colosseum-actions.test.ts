import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Colosseum demo state's server actions.
 *
 * A server action's argument crosses the network, so the annotation is not a
 * guard. These actions must derive the account from the session — never a
 * client-supplied key — and must report `null` on a failed write rather than
 * pretending the state persisted.
 */

const hoisted = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  revalidatePath: vi.fn(),
  start: vi.fn(),
  clear: vi.fn(),
  claim: vi.fn(),
  become: vi.fn(),
  documents: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
}));
vi.mock('next/cache', () => ({ revalidatePath: hoisted.revalidatePath }));
vi.mock('@/lib/residency/colosseum-state-server', () => ({
  startColosseumWindow: hoisted.start,
  clearColosseumWindow: hoisted.clear,
  claimColosseumResidencyPass: hoisted.claim,
  becomeColosseumCitizen: hoisted.become,
  setColosseumDocumentsComplete: hoisted.documents,
}));

import {
  becomeColosseumCitizenAction,
  claimColosseumResidencyAction,
  clearColosseumWindowAction,
  setColosseumDocumentsCompleteAction,
  startColosseumWindowAction,
} from '@/app/residency/actions';

const STATE = {
  progress: {
    residentSince: '2026-01-01T00:00:00.000Z',
    citizenAt: null,
    passportSerial: null,
    residencyPassAt: null,
    residencyPassSerial: null,
  },
  documentsComplete: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getSessionUser.mockResolvedValue({ userId: 'profile-1' });
  hoisted.start.mockResolvedValue(STATE);
  hoisted.clear.mockResolvedValue(STATE);
  hoisted.claim.mockResolvedValue(STATE);
  hoisted.become.mockResolvedValue(STATE);
  hoisted.documents.mockResolvedValue({ ...STATE, documentsComplete: true });
});

describe('Colosseum state server actions — the account comes from the session', () => {
  it('starts the window for the session profile and revalidates both surfaces', async () => {
    const state = await startColosseumWindowAction();
    expect(hoisted.start).toHaveBeenCalledWith('profile-1');
    expect(state).toEqual(STATE);
    expect(hoisted.revalidatePath).toHaveBeenCalledWith('/residency');
    expect(hoisted.revalidatePath).toHaveBeenCalledWith('/');
  });

  it('clears the window for the session profile', async () => {
    await clearColosseumWindowAction();
    expect(hoisted.clear).toHaveBeenCalledWith('profile-1');
  });

  it('claims the residency pass with the session profile and the client demo serial', async () => {
    await claimColosseumResidencyAction('KADE-RES-ABCD2345');
    expect(hoisted.claim).toHaveBeenCalledWith('profile-1', 'KADE-RES-ABCD2345');
  });

  it('records citizenship with the session profile and the client demo serial', async () => {
    await becomeColosseumCitizenAction('KADE-CL-ABCD2345');
    expect(hoisted.become).toHaveBeenCalledWith('profile-1', 'KADE-CL-ABCD2345');
  });

  it('sets the documents flag for the session profile and returns the canonical value', async () => {
    const value = await setColosseumDocumentsCompleteAction(true);
    expect(hoisted.documents).toHaveBeenCalledWith('profile-1', true);
    expect(value).toBe(true);
  });

  it('reports unauthenticated without writing when there is no session', async () => {
    hoisted.getSessionUser.mockResolvedValue(null);
    expect(await startColosseumWindowAction()).toBeNull();
    expect(await claimColosseumResidencyAction('KADE-RES-ABCD2345')).toBeNull();
    expect(await setColosseumDocumentsCompleteAction(true)).toBeNull();
    expect(hoisted.start).not.toHaveBeenCalled();
    expect(hoisted.claim).not.toHaveBeenCalled();
    expect(hoisted.documents).not.toHaveBeenCalled();
  });

  it('reports a failed write as null rather than pretending it persisted', async () => {
    hoisted.claim.mockRejectedValue(new Error('the migration is not applied'));
    expect(await claimColosseumResidencyAction('KADE-RES-ABCD2345')).toBeNull();
    // A failed write does not revalidate: nothing changed.
    expect(hoisted.revalidatePath).not.toHaveBeenCalled();
  });
});
