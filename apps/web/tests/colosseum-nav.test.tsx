import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * The Colosseum nav item is gate-aware.
 *
 * The surface is off by default, so the shell must never link to a route that
 * would 404. `residentNav` adds the Colosseum item only when the gate is on,
 * and `RESIDENT_NAV` (the canonical gate-off list) is unchanged. The shell
 * default is exercised too, so the wiring — not just the builder — is pinned.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: vi.fn() }),
}));
// SafeRetryButton imports the server action lazily; mocking it keeps the
// browser bundle's server-only dependencies out of jsdom.
vi.mock('@/app/onboarding/deploy-actions', () => ({ deployAccount: vi.fn() }));

import { RESIDENT_NAV, residentNav } from '@/components/shell/nav';
import { AppShell } from '@/components/shell/AppShell';

function colosseumItem(groups = RESIDENT_NAV) {
  return groups.flatMap((group) => group.items).find(
    (item) => item.href === '/colosseum',
  );
}

const originalFlag = process.env.KADE_COLOSSEUM;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.KADE_COLOSSEUM;
});

afterEach(() => {
  cleanup();
  if (originalFlag === undefined) delete process.env.KADE_COLOSSEUM;
  else process.env.KADE_COLOSSEUM = originalFlag;
});

describe('residentNav', () => {
  it('omits the Colosseum item when the gate is off', () => {
    const nav = residentNav({ colosseum: false });
    expect(nav).toEqual(RESIDENT_NAV);
    expect(colosseumItem(nav)).toBeUndefined();
  });

  it('adds the Colosseum item to the Residency group when the gate is on', () => {
    const nav = residentNav({ colosseum: true });
    const residency = nav.find((group) => group.label === 'Residency');
    expect(residency?.items).toContainEqual({
      href: '/colosseum',
      label: 'Colosseum',
    });
    // The base nav is untouched, so the item is never a dead link.
    expect(colosseumItem(RESIDENT_NAV)).toBeUndefined();
  });
});

describe('AppShell nav default', () => {
  it('hides the Colosseum link when the gate is off', () => {
    render(
      <AppShell network="Ethereum Sepolia">
        <div>content</div>
      </AppShell>,
    );
    expect(screen.queryByRole('link', { name: 'Colosseum' })).toBeNull();
  });

  it('shows the Colosseum link when the gate is exactly "1"', () => {
    process.env.KADE_COLOSSEUM = '1';
    render(
      <AppShell network="Ethereum Sepolia">
        <div>content</div>
      </AppShell>,
    );
    expect(
      screen.getByRole('link', { name: 'Colosseum' }),
    ).toHaveAttribute('href', '/colosseum');
  });
});
