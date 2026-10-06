import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * Route-level loading shells.
 *
 * The resident routes now share `(resident)/layout.tsx`, which keeps the
 * sidebar, the top banner and the footer mounted across client-side navigation.
 * The loading state therefore covers **only the content area**: these tests pin
 * that the resident fallback draws the content skeleton and nothing else — no
 * shell frame, no sidebar, no footer — while still rendering no data, so no
 * balance, name, address, status or figure can be mistaken for real data.
 *
 * `/login` and `/onboarding` are outside the group and render their own setup
 * flow, never the resident shell, so their fallbacks (and the root fallback that
 * also covers `/admin` and `/vault/withdraw`) must stay shell-free.
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

import ResidentLoading from '@/app/(resident)/loading';
import RootLoading from '@/app/loading';
import LoginLoading from '@/app/login/loading';
import OnboardingLoading from '@/app/onboarding/loading';
import { NavItem } from '@/components/shell/NavItem';
import { RESIDENT_NAV } from '@/components/shell/nav';

/**
 * The shell-free fallbacks: the root segment (which also covers `/admin` and
 * `/vault/withdraw`) and the two non-resident routes.
 */
const PLAIN_LOADERS: ReadonlyArray<readonly [string, () => ReactNode]> = [
  ['/ (root fallback)', RootLoading],
  ['/login', LoginLoading],
  ['/onboarding', OnboardingLoading],
];

/** The text the fallback's decorative placeholder region contains. */
function placeholderText(container: HTMLElement): string {
  const content = container.querySelector('[data-testid="route-loading"]');
  return (content?.textContent ?? '').trim();
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

describe('resident content loading shell', () => {
  it('renders a data-free content skeleton with no shell frame, sidebar or footer', () => {
    const { container } = render(<ResidentLoading />);

    // The content column, with the real content's layout classes so the column
    // does not shift when the page replaces it.
    expect(container.querySelector('.kade-content')).not.toBeNull();
    expect(container.querySelector('.kade-content-padding')).not.toBeNull();
    expect(screen.getByTestId('route-loading')).toBeInTheDocument();

    // The shell frame is entirely absent: the persistent layout already draws
    // it, so the fallback must not draw a second one.
    expect(container.querySelector('.kade-shell')).toBeNull();
    expect(container.querySelector('.kade-sidebar')).toBeNull();
    expect(screen.queryByTestId('route-loading-sidebar')).toBeNull();
    expect(container.querySelectorAll('footer')).toHaveLength(0);

    // No data: every placeholder is an empty shape.
    expect(placeholderText(container)).toBe('');

    // No fabricated or misleading content anywhere.
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

    // An honest status is exposed to assistive tech.
    expect(screen.getByRole('status')).toHaveTextContent('Loading');

    cleanup();
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
