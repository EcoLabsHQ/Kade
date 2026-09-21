import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * Responsive shell coverage.
 *
 * The responsive behaviour lives in `globals.css`, because the app styles with
 * inline `style` objects and a media query cannot be expressed inline.
 * jsdom does not evaluate media queries, so this file does **not** pretend to
 * simulate a narrow viewport: a test that flips a fake `matchMedia` would
 * assert nothing about what actually renders. Instead it asserts the two
 * things that can be asserted honestly:
 *
 *   1. the stylesheet declares exactly one narrow breakpoint and it does the
 *      collapsing work (sidebar off-canvas, grids single-column, padding
 *      scaled); and
 *   2. the components hand layout to those classes instead of baking a fixed
 *      240px sidebar or 40px gutters into inline styles, so the breakpoint can
 *      take effect at all.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

// SafeAddressCard imports the server action lazily; mocking it keeps the
// browser bundle's server-only dependencies out of jsdom.
vi.mock('@/app/onboarding/deploy-actions', () => ({
  deployAccount: vi.fn(),
}));

import { Sidebar } from '@/components/shell/Sidebar';
import { ContentContainer } from '@/components/shell/ContentContainer';

// vitest runs from the package root (`apps/web`), so the stylesheet path is
// resolved from the working directory rather than `import.meta.url`, which the
// transform does not expose as a file URL.
const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

/** The body of the first block opened by `query`, by brace matching. */
function blockAfter(source: string, query: string): string {
  const start = source.indexOf(query);
  expect(start, `expected to find ${query}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced braces after ${query}`);
}

describe('breakpoint strategy', () => {
  it('uses exactly one narrow breakpoint for the whole shell', () => {
    const breakpoints = css.match(/@media\s*\(max-width:\s*768px\)/g) ?? [];
    expect(breakpoints).toHaveLength(1);
  });

  it('turns the sidebar into an off-canvas drawer below the breakpoint', () => {
    const narrow = blockAfter(css, '@media (max-width: 768px)');
    const sidebar = blockAfter(narrow, '.kade-sidebar');

    expect(sidebar).toMatch(/position:\s*fixed/);
    expect(sidebar).toMatch(/transform:\s*translateX\(-100%\)/);
    // The desktop sidebar width must not survive into the narrow drawer.
    expect(sidebar).not.toMatch(/var\(--kade-sidebar-width\)/);
    expect(sidebar).toMatch(/width:\s*min\(86vw,\s*320px\)/);
  });

  it('stacks every two-column grid into one column below the breakpoint', () => {
    const narrow = blockAfter(css, '@media (max-width: 768px)');

    for (const selector of [
      '.kade-grid-2',
      '.kade-grid-4',
      '.kade-grid-dashboard',
    ]) {
      const rule = blockAfter(narrow, selector);
      expect(rule).toMatch(/grid-template-columns:\s*1fr/);
    }
  });

  it('scales the content gutters below the breakpoint', () => {
    const desktop = blockAfter(css, '.kade-content');
    expect(desktop).toMatch(/padding:\s*36px 40px 64px/);

    const narrow = blockAfter(css, '@media (max-width: 768px)');
    const content = blockAfter(narrow, '.kade-content');
    expect(content).toMatch(/padding:\s*20px 16px 48px/);
  });
});

describe('Sidebar', () => {
  it('leaves the sidebar width to the stylesheet instead of a fixed 240px', () => {
    render(
      <Sidebar
        nav={[]}
        network="Ethereum Sepolia"
        safeAddress={null}
        email={null}
      />,
    );

    const sidebar = screen.getByRole('complementary');
    expect(sidebar).toHaveClass('kade-sidebar');
    // No inline width: an inline width would outrank the media query and the
    // drawer could never collapse.
    expect(sidebar.getAttribute('style') ?? '').not.toMatch(/240px/);
    expect(sidebar.style.width).toBe('');
    expect(sidebar.style.flex).toBe('');
  });

  it('provides a non-JavaScript nav toggle as a sibling of the sidebar', () => {
    render(
      <Sidebar
        nav={[]}
        network="Ethereum Sepolia"
        safeAddress={null}
        email={null}
      />,
    );

    const toggle = screen.getByRole('checkbox', { name: /toggle navigation/i });
    const sidebar = screen.getByRole('complementary');

    // The stylesheet drives the drawer with `.kade-nav-toggle:checked ~
    // .kade-sidebar`, so the checkbox must precede the sidebar.
    expect(
      toggle.compareDocumentPosition(sidebar) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(sidebar.parentElement?.querySelector('.kade-nav-toggle')).toBe(
      toggle,
    );
  });
});

describe('ContentContainer', () => {
  it('moves the gutters into the responsive class', () => {
    const { container } = render(<ContentContainer>content</ContentContainer>);
    const root = container.firstElementChild as HTMLElement;

    expect(root).toHaveClass('kade-content');
    expect(root.style.padding).toBe('');
  });
});
