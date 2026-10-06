import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * Route-level loading shells.
 *
 * The resident routes share `(resident)/layout.tsx`, which keeps the sidebar,
 * the top banner and the footer mounted across client-side navigation. In
 * Next.js 15.5.25 a segment's `loading.tsx` wraps that segment's **children**
 * (its pages), not the `layout.tsx` in the same folder: the boundary that covers
 * `(resident)/layout.tsx` is the parent segment's boundary, `app/loading.tsx`.
 * Evidence is in `create-component-tree.js` (a segment's `loadingData` is
 * returned to its parent) and `layout-router.js` (the parent's
 * `parentCacheNode.loading` wraps the child slot).
 *
 * These tests therefore pin three separate contracts:
 *
 *   1. the root boundary — the one that covers the resident layout — renders
 *      the resident **shell** skeleton, never the setup placeholder;
 *   2. the group's own `(resident)/loading.tsx` renders the **content-only**
 *      skeleton, with no duplicated chrome; and
 *   3. `/login` and `/onboarding` render the **setup-flow** placeholder
 *      (setup sidebar + main column), not the resident shell.
 *
 * Every fallback renders no data: no balance, name, address, status or figure
 * can be mistaken for real content, and the only text is the honest
 * visually-hidden `role="status"` "Loading".
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
import RootLoading, { PlainLoading, ResidentShellLoading } from '@/app/loading';
import LoginLoading from '@/app/login/loading';
import OnboardingLoading from '@/app/onboarding/loading';
import { NavItem } from '@/components/shell/NavItem';
import { RESIDENT_NAV } from '@/components/shell/nav';

/** The setup-flow fallbacks: the two non-resident routes and the shared export. */
const SETUP_LOADERS: ReadonlyArray<readonly [string, () => ReactNode]> = [
  ['/login', LoginLoading],
  ['/onboarding', OnboardingLoading],
  ['PlainLoading', PlainLoading],
];

/**
 * Assert that nothing on the fallback is a fabricated figure. The only text any
 * fallback may render is the honest status, so this is the same check for every
 * shell.
 */
function expectNoFabricatedData(container: HTMLElement): void {
  const text = container.textContent ?? '';
  expect(text).not.toMatch(/[0-9]/);
  expect(text).not.toMatch(/[$€£%]/);
  expect(text).not.toMatch(/0x/i);
  expect(text.toLowerCase()).not.toContain('no account yet');
  expect(text.toLowerCase()).not.toContain('created');
  expect(text.toLowerCase()).not.toContain('deployed');
  expect(text.toLowerCase()).not.toContain('pre-approved');
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
    const content = container.querySelector('[data-testid="route-loading"]');
    expect((content?.textContent ?? '').trim()).toBe('');

    // No fabricated or misleading content anywhere.
    expectNoFabricatedData(container);
    expect(screen.queryByTestId('safe-address-card')).toBeNull();
    expect(screen.queryByTestId('sidebar-review-notice')).toBeNull();

    // An honest status is exposed to assistive tech.
    expect(screen.getByRole('status')).toHaveTextContent('Loading');

    cleanup();
  });
});

describe('the root boundary that covers the resident layout', () => {
  it('renders the resident shell skeleton, never the setup placeholder', () => {
    const { container } = render(<RootLoading />);

    // It is the shell skeleton: the shell frame and sidebar are drawn so the
    // column matches the real resident screen...
    expect(container.querySelector('.kade-shell')).not.toBeNull();
    expect(container.querySelector('.kade-sidebar')).not.toBeNull();
    expect(screen.getByTestId('route-loading-shell')).toBeInTheDocument();
    // ...with the content skeleton the group boundary also uses, so the column
    // does not jump when the layout resolves.
    expect(screen.getByTestId('route-loading')).toBeInTheDocument();

    // It is NOT the setup placeholder that `/login` and `/onboarding` use, and
    // it fabricates none of the resident chrome's real content.
    expect(screen.queryByTestId('route-loading-plain')).toBeNull();
    expect(screen.queryByTestId('safe-address-card')).toBeNull();
    expect(screen.queryByTestId('sidebar-review-notice')).toBeNull();
    // No nav links are invented: the rail is empty shapes only.
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.querySelectorAll('footer')).toHaveLength(0);

    expectNoFabricatedData(container);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');

    cleanup();
  });

  it('is the same shell skeleton the named export renders', () => {
    const { container } = render(<ResidentShellLoading />);
    expect(screen.getByTestId('route-loading-shell')).toBeInTheDocument();
    expect(container.querySelector('.kade-shell')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    cleanup();
  });
});

describe('setup loading shells for the non-resident routes', () => {
  for (const [route, Loading] of SETUP_LOADERS) {
    it(`renders the setup-flow placeholder, not the resident shell, for ${route}`, () => {
      const { container } = render(<Loading />);

      // It mirrors the real setup screen's two-column structure: the setup
      // sidebar plus the main content column, inside the same shell class.
      expect(screen.getByTestId('route-loading-plain')).toBeInTheDocument();
      expect(container.querySelector('.kade-shell')).not.toBeNull();
      expect(container.querySelector('.kade-sidebar')).not.toBeNull();
      expect(container.querySelector('.kade-content')).not.toBeNull();

      // It is NOT the resident shell: no resident content skeleton, no Safe
      // card, no review notice, no nav links, no footer.
      expect(screen.queryByTestId('route-loading-shell')).toBeNull();
      expect(screen.queryByTestId('route-loading')).toBeNull();
      expect(screen.queryByTestId('route-loading-sidebar')).toBeNull();
      expect(screen.queryByTestId('safe-address-card')).toBeNull();
      expect(screen.queryByTestId('sidebar-review-notice')).toBeNull();
      expect(container.querySelectorAll('a')).toHaveLength(0);
      expect(container.querySelectorAll('footer')).toHaveLength(0);

      // No fabricated text or data anywhere (only the honest status).
      expectNoFabricatedData(container);

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
