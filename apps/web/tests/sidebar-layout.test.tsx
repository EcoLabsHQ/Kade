import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * The sidebar's vertical layout.
 *
 * jsdom does not compute layout, so the flexible space is asserted where it is
 * actually decided: the DOM. Exactly one direct child of `.kade-sidebar` may
 * grow to absorb the leftover height, and it must sit *above* the Safe address
 * card. The grower used to live inside `SidebarFooter`, which absorbed the
 * space between the card and the footer and stranded the card at the top — the
 * defect this file pins shut.
 *
 * This proves the structure, not the pixels. A reviewer must still confirm the
 * rendering in a browser, because jsdom cannot.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: vi.fn() }),
}));

// SafeRetryButton imports the server action lazily; mocking it keeps the
// browser bundle's server-only dependencies out of jsdom.
vi.mock('@/app/onboarding/deploy-actions', () => ({
  deployAccount: vi.fn(),
}));

import { Sidebar } from '@/components/shell/Sidebar';
import { SetupSidebar } from '@/components/shell/SetupSidebar';

const NAV = [{ items: [{ href: '/', label: 'Overview' }] }];
const STEPS = [
  { title: 'Connect', state: 'active' as const },
  { title: 'Safe', state: 'locked' as const, lockReason: 'Finish step 1' },
];

/** True when an element is set to grow along the sidebar's main axis. */
function grows(el: Element): boolean {
  const node = el as HTMLElement;
  if (node.style.flexGrow === '1') return true;
  // jsdom does not always decompose the `flex` shorthand, so read it too.
  return node.style.flex.trim().split(/\s+/)[0] === '1';
}

/** The direct children of the sidebar that can absorb vertical slack. */
function directGrowers(sidebar: HTMLElement): HTMLElement[] {
  return Array.from(sidebar.children).filter(grows) as HTMLElement[];
}

/** True when `a` comes before `b` in document order. */
function precedes(a: Element, b: Element): boolean {
  return Boolean(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

/** The Safe card's wrapper: the account-settings link's grandparent. */
function safeCardWrapper(): HTMLElement {
  return screen.getByRole('link', { name: 'Account settings' })
    .parentElement!.parentElement as HTMLElement;
}

describe('Sidebar vertical layout', () => {
  it('keeps the only flexible spacer above the Safe card on the grouped nav', () => {
    render(
      <Sidebar
        nav={NAV}
        network="Ethereum Sepolia"
        safeAddress={null}
        email="resident@example.com"
      />,
    );

    const sidebar = screen.getByRole('complementary');
    const cardWrapper = safeCardWrapper();

    const growers = directGrowers(sidebar);
    expect(growers).toHaveLength(1);
    const spacer = growers[0]!;

    // The spacer is a direct child and precedes the card, so the leftover
    // space cannot fall below the card.
    expect(spacer.parentElement).toBe(sidebar);
    expect(precedes(spacer, cardWrapper)).toBe(true);
    expect(cardWrapper.previousElementSibling).toBe(spacer);

    // Nothing after the card may also grow, or the gap would split between the
    // card and the footer.
    const siblings = Array.from(sidebar.children);
    expect(siblings.slice(siblings.indexOf(cardWrapper) + 1).some(grows)).toBe(
      false,
    );

    // The card still precedes the footer's content (the user menu button,
    // which now owns sign-out).
    expect(
      precedes(
        cardWrapper,
        screen.getByRole('button', { name: 'resident@example.com' }),
      ),
    ).toBe(true);
    cleanup();
  });

  it('keeps the spacer above the Safe card on the stepper branch', () => {
    render(
      <Sidebar
        nav={[]}
        stepper={STEPS}
        network="Ethereum Sepolia"
        safeAddress={null}
        email="resident@example.com"
      />,
    );

    const sidebar = screen.getByRole('complementary');
    const cardWrapper = safeCardWrapper();

    // The stepper (not the grouped nav) is the render under test.
    expect(screen.getByText('Resident setup')).toBeInTheDocument();

    const growers = directGrowers(sidebar);
    expect(growers).toHaveLength(1);
    expect(cardWrapper.previousElementSibling).toBe(growers[0]);
    cleanup();
  });

  it('leaves SetupSidebar with the same single spacer above its account card', () => {
    render(
      <SetupSidebar
        steps={STEPS}
        network="Ethereum Sepolia"
        accountState={{ kind: 'anonymous' }}
      />,
    );

    const sidebar = screen.getByRole('complementary');
    const growers = directGrowers(sidebar);
    expect(growers).toHaveLength(1);
    const spacer = growers[0]!;

    // The spacer is not the last thing: the account card, the Resident/Admin
    // switch and the credit all follow it, and none of them also grows.
    expect(spacer.nextElementSibling).not.toBeNull();
    const siblings = Array.from(sidebar.children);
    expect(siblings.slice(siblings.indexOf(spacer) + 1).some(grows)).toBe(
      false,
    );
    expect(precedes(spacer, screen.getByText('Not signed in'))).toBe(true);
    cleanup();
  });
});
