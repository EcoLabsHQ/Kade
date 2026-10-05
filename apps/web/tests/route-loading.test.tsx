import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * Route-level loading shells.
 *
 * The human's complaint was that a click between pages produced 1–2 seconds of
 * dead screen. The fix is App Router `loading.tsx` fallbacks that paint the
 * shell immediately while the `force-dynamic` page resolves. These tests pin the
 * two properties that make the fallback safe:
 *
 *   1. it renders **no data** — the placeholder region's text content is empty,
 *      so no balance, name, address, status or figure can be mistaken for real
 *      data (in particular it must not render the Safe card's "no account yet"
 *      status while the real account loads); and
 *   2. it renders the frame once — a single global footer, the same shell
 *      classes and paddings, so the layout does not jump when the page arrives.
 *
 * It also pins the navigation prefetch contract: the resident nav destinations
 * are Next `<Link>`s with the default (hover/viewport) prefetch, never
 * `prefetch={false}`.
 */

const linkSpy = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock('next/link', () => ({
  default: (props: {
    readonly href: string;
    readonly prefetch?: boolean;
    readonly children?: ReactNode;
    readonly [key: string]: unknown;
  }) => {
    linkSpy.calls.push(props);
    return (
      <a
        href={props.href}
        data-prefetch={props.prefetch === undefined ? 'default' : String(props.prefetch)}
      >
        {props.children}
      </a>
    );
  },
}));

import RootLoading from '@/app/loading';
import HoldingsLoading from '@/app/holdings/loading';
import InvestLoading from '@/app/invest/loading';
import ResidencyLoading from '@/app/residency/loading';
import BankLoading from '@/app/bank/loading';
import CardLoading from '@/app/card/loading';
import VoteLoading from '@/app/vote/loading';
import AccountLoading from '@/app/account/loading';
import LoginLoading from '@/app/login/loading';
import OnboardingLoading from '@/app/onboarding/loading';
import { NavItem } from '@/components/shell/NavItem';
import { RESIDENT_NAV } from '@/components/shell/nav';

/** Every resident-shell route's fallback, so a missing file fails the suite. */
const LOADERS: ReadonlyArray<readonly [string, () => ReactNode]> = [
  ['/', RootLoading],
  ['/holdings', HoldingsLoading],
  ['/invest', InvestLoading],
  ['/residency', ResidencyLoading],
  ['/bank', BankLoading],
  ['/card', CardLoading],
  ['/vote', VoteLoading],
  ['/account', AccountLoading],
];

/**
 * The non-resident routes. They render their own setup flow, never the resident
 * `AppShell`, so their fallbacks must not draw a resident sidebar or frame.
 */
const PLAIN_LOADERS: ReadonlyArray<readonly [string, () => ReactNode]> = [
  ['/login', LoginLoading],
  ['/onboarding', OnboardingLoading],
];

/** The text the fallback's decorative placeholder regions contain. */
function placeholderText(container: HTMLElement): string {
  const content = container.querySelector('[data-testid="route-loading"]');
  const sidebar = container.querySelector('[data-testid="route-loading-sidebar"]');
  return `${content?.textContent ?? ''}${sidebar?.textContent ?? ''}`.trim();
}

/**
 * The fallback's text with the real global footer removed. The footer's
 * copyright year is real data, so it is excluded before asserting that nothing
 * on the loading screen is a fabricated figure.
 */
function textWithoutFooter(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('footer').forEach((footer) => footer.remove());
  return clone.textContent ?? '';
}

describe('route loading shells', () => {
  for (const [route, Loading] of LOADERS) {
    it(`renders an immediate, data-free shell for ${route}`, () => {
      const { container } = render(<Loading />);

      // The shell frame, with the real shell's layout classes so the frame
      // does not shift when the page replaces it.
      expect(container.querySelector('.kade-shell')).not.toBeNull();
      expect(container.querySelector('.kade-sidebar')).not.toBeNull();
      expect(container.querySelector('.kade-content')).not.toBeNull();
      expect(container.querySelector('.kade-content-padding')).not.toBeNull();
      expect(screen.getByTestId('route-loading')).toBeInTheDocument();

      // No data: every placeholder is an empty shape.
      expect(placeholderText(container)).toBe('');

      // No fabricated or misleading content anywhere outside the real footer.
      const text = textWithoutFooter(container);
      expect(text).not.toMatch(/[0-9]/);
      expect(text).not.toMatch(/[$€£%]/);
      expect(text).not.toMatch(/0x/i);
      expect(text.toLowerCase()).not.toContain('no account yet');
      expect(text.toLowerCase()).not.toContain('created');
      expect(text.toLowerCase()).not.toContain('deployed');
      expect(text.toLowerCase()).not.toContain('pre-approved');
      expect(screen.queryByTestId('safe-address-card')).toBeNull();
      expect(screen.queryByTestId('sidebar-review-notice')).toBeNull();

      // The global footer is rendered once, never duplicated by the fallback.
      expect(container.querySelectorAll('footer')).toHaveLength(1);

      // An honest status is exposed to assistive tech.
      expect(screen.getByRole('status')).toHaveTextContent('Loading');

      cleanup();
    });
  }

  it('shares one skeleton across every covered route', () => {
    const rendered = LOADERS.map(([, Loading]) => {
      const { container } = render(<Loading />);
      const html = container.innerHTML;
      cleanup();
      return html;
    });
    // Identical output means the per-route files really re-use the one shell
    // rather than drifting into eight copies.
    expect(new Set(rendered).size).toBe(1);
  });
});

describe('plain loading shells for non-resident routes', () => {
  for (const [route, Loading] of PLAIN_LOADERS) {
    it(`renders a neutral, shell-free placeholder for ${route}`, () => {
      const { container } = render(<Loading />);

      // The minimal placeholder is present...
      expect(screen.getByTestId('route-loading-plain')).toBeInTheDocument();

      // ...and the resident shell frame is entirely absent: no sidebar, no
      // shell wrapper, no resident skeleton, no Safe card, no footer.
      expect(container.querySelector('.kade-shell')).toBeNull();
      expect(container.querySelector('.kade-sidebar')).toBeNull();
      expect(screen.queryByTestId('route-loading')).toBeNull();
      expect(screen.queryByTestId('route-loading-sidebar')).toBeNull();
      expect(screen.queryByTestId('safe-address-card')).toBeNull();
      expect(container.querySelectorAll('footer')).toHaveLength(0);

      // No fabricated text or data anywhere (only the honest status).
      const text = container.textContent ?? '';
      expect(text).not.toMatch(/[0-9]/);
      expect(text).not.toMatch(/[$€£%]/);
      expect(text).not.toMatch(/0x/i);
      expect(text.toLowerCase()).not.toContain('no account yet');
      expect(text.toLowerCase()).not.toContain('created');
      expect(text.toLowerCase()).not.toContain('deployed');

      // An honest status is exposed to assistive tech.
      expect(screen.getByRole('status')).toHaveTextContent('Loading');

      cleanup();
    });
  }

  it('still renders the resident shell frame on the resident routes', () => {
    const { container } = render(<RootLoading />);
    expect(container.querySelector('.kade-shell')).not.toBeNull();
    expect(container.querySelector('.kade-sidebar')).not.toBeNull();
    expect(container.querySelectorAll('footer')).toHaveLength(1);
    cleanup();
  });
});

describe('resident nav prefetch', () => {
  it('renders every destination as a Next Link with default prefetch', () => {
    for (const item of RESIDENT_NAV.flatMap((group) => group.items)) {
      linkSpy.calls.length = 0;
      const { unmount } = render(<NavItem item={item} active={false} />);

      const props = linkSpy.calls.at(-1);
      expect(props, `expected a Next Link for ${item.href}`).toBeDefined();
      expect(props?.href).toBe(item.href);
      // Default prefetch (hover/viewport); never disabled.
      expect(props?.prefetch).toBeUndefined();

      const link = screen.getByRole('link', { name: item.label });
      expect(link).toHaveAttribute('href', item.href);

      unmount();
    }
  });

  it('keeps locked destinations as disabled controls, not links', () => {
    const locked = { href: '/vault', label: 'Vault', locked: true, lockReason: 'Locked' };
    linkSpy.calls.length = 0;
    render(<NavItem item={locked} active={false} />);

    expect(screen.queryByRole('link', { name: 'Vault' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Vault' })).toBeDisabled();
    expect(linkSpy.calls).toHaveLength(0);
    cleanup();
  });
});
