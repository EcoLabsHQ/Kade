import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { deriveResidencyView, type ResidencyFacts } from '@/lib/residency/checks';
import type { ResidencySnapshot } from '@/lib/residency/server';

/**
 * The Colosseum route's server-side wiring.
 *
 * The route is a 404 unless the gate is exactly `KADE_COLOSSEUM=1`; when
 * enabled it is auth-gated exactly like `/residency` — no session goes to
 * `/login`, and a resident with no application goes to `/onboarding`. When a
 * snapshot exists, it and the persisted membership are handed to the client
 * screen.
 */

const hoisted = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  getSessionUser: vi.fn(),
  loadResidencySnapshot: vi.fn(),
  loadColosseumMembership: vi.fn(),
  loadShellSafe: vi.fn(),
  screenProps: null as Record<string, unknown> | null,
}));

vi.mock('next/navigation', () => ({
  notFound: hoisted.notFound,
  redirect: hoisted.redirect,
}));
vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
}));
vi.mock('@/lib/residency/server', () => ({
  loadResidencySnapshot: hoisted.loadResidencySnapshot,
}));
vi.mock('@/lib/colosseum/server', () => ({
  loadColosseumMembership: hoisted.loadColosseumMembership,
}));
vi.mock('@/lib/safe/shell', () => ({
  loadShellSafe: hoisted.loadShellSafe,
}));
vi.mock('@/lib/review/review-bar', () => ({
  loadReviewBar: vi.fn(async () => ({
    show: false,
    reference: null,
    isReviewer: false,
  })),
}));
vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/shell/ContentContainer', () => ({
  ContentContainer: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/shell/SiteFooter', () => ({ SiteFooter: () => null }));
vi.mock('@/components/colosseum/ColosseumScreen', () => ({
  ColosseumScreen: (props: Record<string, unknown>) => {
    hoisted.screenProps = props;
    return null;
  },
}));

import ColosseumPage from '@/app/colosseum/page';

const ALL_MET: ResidencyFacts = {
  tier: 'colosseum',
  identity: {
    provider: 'self',
    status: 'valid',
    verifiedAt: '2026-09-20T00:00:00Z',
    selfNullifier: 'n',
  },
  qualified: { status: 'known', usd: 10 },
  review: 'cleared',
  serviceFee: { recorded: true, verified: true, amountUsdc: 10 },
  permit: { issued: false, uid: null },
};

const SNAPSHOT: ResidencySnapshot = {
  applicationId: 'app-1',
  applicationRef: 'CW-2026-0409',
  tier: ALL_MET.tier,
  status: 'pre_approved',
  view: deriveResidencyView(ALL_MET, true),
  preapprovalPaid: true,
  serviceFeeAmountUsdc: 10,
  preapprovalUsdc: 447,
  serviceFeeConfigured: true,
  selfConfigured: false,
  permit: { status: 'not-configured', reason: 'no gate' },
};

const MEMBERSHIP = {
  residentSince: '2026-10-02T00:00:00.000Z',
  citizenAt: null,
  passportSerial: null,
};

const originalFlag = process.env.KADE_COLOSSEUM;

beforeEach(() => {
  hoisted.screenProps = null;
  process.env.KADE_COLOSSEUM = '1';
  hoisted.getSessionUser.mockResolvedValue({
    userId: 'user-1',
    email: 'resident@example.com',
    provider: 'email',
  });
  hoisted.loadResidencySnapshot.mockResolvedValue(SNAPSHOT);
  hoisted.loadColosseumMembership.mockResolvedValue(MEMBERSHIP);
  hoisted.loadShellSafe.mockResolvedValue({
    address: null,
    deployed: false,
    status: null,
    explorerUrl: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
  if (originalFlag === undefined) delete process.env.KADE_COLOSSEUM;
  else process.env.KADE_COLOSSEUM = originalFlag;
});

describe('ColosseumPage', () => {
  it('is a 404 when the gate is off, before any session read', async () => {
    delete process.env.KADE_COLOSSEUM;
    await expect(ColosseumPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(hoisted.notFound).toHaveBeenCalledTimes(1);
    expect(hoisted.getSessionUser).not.toHaveBeenCalled();
  });

  it('redirects to login when there is no session', async () => {
    hoisted.getSessionUser.mockResolvedValue(null);
    await expect(ColosseumPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(hoisted.loadResidencySnapshot).not.toHaveBeenCalled();
  });

  it('redirects to onboarding when there is no application', async () => {
    hoisted.loadResidencySnapshot.mockResolvedValue(null);
    await expect(ColosseumPage()).rejects.toThrow('NEXT_REDIRECT:/onboarding');
  });

  it('hands the snapshot and membership to the client screen', async () => {
    render((await ColosseumPage()) as ReactElement);

    expect(hoisted.screenProps).not.toBeNull();
    expect(hoisted.screenProps?.snapshot).toEqual(SNAPSHOT);
    expect(hoisted.screenProps?.membership).toEqual(MEMBERSHIP);
  });
});
