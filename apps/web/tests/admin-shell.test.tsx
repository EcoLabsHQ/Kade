import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * The Admin page's shell.
 *
 * `/admin` sits outside the `(resident)` route group and renders its own
 * `AppShell`, so it must supply its own shell slots. It did not: it passed no
 * `safeCard`, so the sidebar fell back to the value-prop `SafeAddressCard` with
 * `address = null` and showed the "no account yet"/`0x…` placeholder even for a
 * resident whose Safe record exists. These tests pin the fix:
 *
 *   1. the page wires the same streamed `ShellSafeCard` slot the resident layout
 *      uses, resolved from `loadShellSafe` for the signed-in user;
 *   2. the resolved slot shows the real address, and still degrades honestly to
 *      the existing placeholder when there is no record; and
 *   3. the Resident half of the switch is a real link back to the resident view,
 *      and it is not styled as the live mode while Admin is highlighted.
 *
 * What the pre-fix code would do, stated so the coverage is provably not
 * vacuous:
 *   - `await AdminPage()` returned an `AppShell` whose `safeCard` prop was
 *     `undefined`, so the first test's fallback assertion failed (there was no
 *     `shell-safe-card-fallback`) and its `safe-address-card` assertion failed
 *     (the value-prop card rendered with the placeholder);
 *   - the second and third tests dereferenced `props.safeCard` and failed with
 *     a TypeError before any address could be asserted; and
 *   - `Resident` was a static `<span>`, so `getByRole('link', { name:
 *     'Resident' })` found nothing.
 */

const hoisted = vi.hoisted(() => ({
  redirect: vi.fn(),
  getSessionUser: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  loadReviewQueue: vi.fn(),
  loadShellSafe: vi.fn(),
  loadReviewBar: vi.fn(),
  isAuthConfigured: vi.fn(),
  readAuthEnv: vi.fn(),
  readChainEnv: vi.fn(),
  submitReview: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: hoisted.redirect,
  usePathname: () => '/admin',
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/lib/supabase/server', () => ({
  getSessionUser: hoisted.getSessionUser,
  createSupabaseServerClient: hoisted.createSupabaseServerClient,
}));

vi.mock('@/lib/review/queue', () => ({
  loadReviewQueue: hoisted.loadReviewQueue,
}));
vi.mock('@/lib/safe/shell', () => ({ loadShellSafe: hoisted.loadShellSafe }));
vi.mock('@/lib/review/review-bar', () => ({
  loadReviewBar: hoisted.loadReviewBar,
}));
vi.mock('@/lib/env', () => ({
  isAuthConfigured: hoisted.isAuthConfigured,
  readAuthEnv: hoisted.readAuthEnv,
  readChainEnv: hoisted.readChainEnv,
}));
vi.mock('@/app/admin/review-actions', () => ({
  submitReview: hoisted.submitReview,
}));

import AdminPage from '@/app/admin/page';
import { AppShell, type AppShellProps } from '@/components/shell/AppShell';

const SAFE = '0x5Af1000000000000000000000000000000000c09D';

const REVIEWER = { id: 'user-1', role: 'reviewer' };

/** A Supabase client stub good enough for the page's reviewer-role read. */
function clientWithReviewer(reviewer: { id: string; role: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: reviewer, error: null }),
        }),
      }),
    }),
  };
}

/**
 * Resolve the async component inside a `<Suspense>` shell slot, exactly as the
 * server renderer would. jsdom's client renderer cannot resolve an async
 * component (it suspends and shows the fallback forever), so the slot is
 * unwrapped here to assert what the server would send.
 */
async function resolveSlot(slot: ReactElement): Promise<ReactElement> {
  const inner = (slot.props as { children: ReactElement }).children;
  const Component = inner.type as unknown as (
    props: Record<string, unknown>,
  ) => Promise<ReactElement>;
  return Component(inner.props as Record<string, unknown>);
}

/** The props of the `AppShell` element the page returned. */
function shellProps(page: unknown): AppShellProps {
  return (page as ReactElement).props as AppShellProps;
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getSessionUser.mockResolvedValue({
    userId: 'user-1',
    email: 'reviewer@example.com',
    provider: 'email',
  });
  hoisted.createSupabaseServerClient.mockResolvedValue(
    clientWithReviewer(REVIEWER),
  );
  hoisted.loadReviewQueue.mockResolvedValue([]);
  hoisted.loadShellSafe.mockResolvedValue({
    address: SAFE,
    deployed: true,
    status: 'deployed',
    explorerUrl: null,
  });
  hoisted.loadReviewBar.mockResolvedValue({
    show: false,
    reference: null,
    reviewed: false,
    isReviewer: true,
  });
  hoisted.isAuthConfigured.mockReturnValue(true);
  hoisted.readAuthEnv.mockReturnValue({});
  hoisted.readChainEnv.mockReturnValue('testnet');
});

describe('admin shell Safe card', () => {
  it('wires the streamed Safe-card slot, not the value-prop placeholder', async () => {
    render((await AdminPage()) as ReactElement);

    // The streamed slot is what the shell renders; the resolved card is still
    // streaming, so its neutral fallback is up.
    expect(screen.getByTestId('shell-safe-card-fallback')).toBeInTheDocument();
    // The value-prop card (address null -> "0x…"/"no account yet") must not be
    // what an admin sees, which is exactly the pre-fix behaviour.
    expect(screen.queryByTestId('safe-address-card')).toBeNull();
  });

  it('shows the signed-in user\u2019s real Safe address in the admin shell', async () => {
    const page = await AdminPage();
    const resolved = await resolveSlot(shellProps(page).safeCard as ReactElement);

    // Render the actual admin shell with the slot resolved, as the server would.
    render(<AppShell {...shellProps(page)} safeCard={resolved} />);

    expect(screen.getByText(SAFE)).toBeInTheDocument();
    // The address came from the same read the resident shell uses, for the
    // signed-in user \u2014 not a second, admin-only query.
    expect(hoisted.loadShellSafe).toHaveBeenCalledWith('user-1');
  });

  it('degrades to the existing placeholder when the user has no Safe', async () => {
    hoisted.loadShellSafe.mockResolvedValue({
      address: null,
      deployed: false,
      status: null,
      explorerUrl: null,
    });

    const page = await AdminPage();
    const resolved = await resolveSlot(shellProps(page).safeCard as ReactElement);
    render(<AppShell {...shellProps(page)} safeCard={resolved} />);

    expect(screen.getByText(/no account yet/i)).toBeInTheDocument();
    expect(screen.queryByText(SAFE)).toBeNull();
  });
});

describe('admin shell Resident switch', () => {
  it('makes Resident a link back to the resident view, and not the live mode', async () => {
    render((await AdminPage()) as ReactElement);

    const resident = screen.getByRole('link', { name: 'Resident' });
    expect(resident).toHaveAttribute('href', '/');
    // In admin mode the Resident half must not read as active; the Admin half is
    // the current mode and announces itself.
    expect(resident).not.toHaveAttribute('aria-current');
    expect(resident.style.background).toBe('transparent');

    const admin = screen.getByRole('link', { name: 'Admin' });
    expect(admin).toHaveAttribute('href', '/admin');
    expect(admin).toHaveAttribute('aria-current', 'page');
  });

  it('keeps the Resident link keyboard reachable', async () => {
    render((await AdminPage()) as ReactElement);

    const resident = screen.getByRole('link', { name: 'Resident' });
    resident.focus();
    expect(document.activeElement).toBe(resident);
  });
});
