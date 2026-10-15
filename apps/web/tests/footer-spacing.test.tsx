import { describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { AppShell } from '@/components/shell/AppShell';
import { LoginScreen } from '@/components/auth/LoginScreen';

vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signInWithOAuth: vi.fn(),
      signInWithOtp: vi.fn(),
    },
  }),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ refresh: vi.fn() }),
}));

// SafeAddressCard imports the server action lazily; mocking it keeps the
// browser bundle's server-only dependencies out of jsdom.
vi.mock('@/app/onboarding/deploy-actions', () => ({ deployAccount: vi.fn() }));

/** The footer rendered as the last item of a shell-like flex column. */
function renderFooterBelow(contentHeight: number) {
  return render(
    <div
      style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <div style={{ height: contentHeight }} />
      <SiteFooter />
    </div>,
  );
}

describe('footer bottom spacing', () => {
  it('owns a fixed bottom gap that does not depend on sibling content', () => {
    const short = renderFooterBelow(20);
    const shortFooter = short.container.querySelector('footer') as HTMLElement;
    const shortStyle = shortFooter.getAttribute('style');
    expect(shortFooter.style.paddingBottom).toBe('18px');
    // Still pinned to the bottom of the flex column on a short page.
    expect(shortFooter.style.marginTop).toBe('auto');
    cleanup();

    const tall = renderFooterBelow(5000);
    const tallFooter = tall.container.querySelector('footer') as HTMLElement;
    expect(tallFooter.style.paddingBottom).toBe('18px');
    // The whole style is identical, so the gap cannot vary with content length.
    expect(tallFooter.getAttribute('style')).toBe(shortStyle);
  });

  it('keeps the content-to-footer gap on the content column, not below the footer', () => {
    const { container } = render(
      <ContentContainer footer={<SiteFooter />}>
        <p>content</p>
      </ContentContainer>,
    );
    const column = container.firstElementChild as HTMLElement;
    const paddedContent = column.firstElementChild as HTMLElement;
    const footer = column.querySelector('footer') as HTMLElement;

    // The 64px gap belongs to the padded content region, so it stays above the
    // footer. It lives in `.kade-content-padding` (globals.css) rather than
    // inline, because it changes at the responsive breakpoint and an inline
    // style cannot carry a media query — so assert the class, not a style.
    expect(paddedContent.className).toContain('kade-content-padding');
    // The footer is a sibling of the padded region, never inside its padding,
    // so the container's 64px can never stack underneath the footer.
    expect(paddedContent.contains(footer)).toBe(false);
    expect(footer.parentElement).toBe(column);
    // The gap below the footer is the footer's own fixed value.
    expect(footer.style.paddingBottom).toBe('18px');
    // And the outer column must NOT also be padded, or the two would compound.
    // Assert the exact class list, not a substring: `kade-content
    // kade-content-padding` would pass a `toContain` check while applying the
    // padding twice, which is the bug this test exists to catch.
    expect(column.className.trim()).toBe('kade-content');
    expect(column.style.padding).toBe('');
  });

  it('renders the login screen footer outside the padded content column', () => {
    const { container } = render(
      <LoginScreen
        configured
        available={{ google: true, email: true }}
        callbackUrl="http://localhost:3000/auth/callback"
        network="Ethereum Sepolia"
        accountState={{ kind: 'anonymous' }}
      />,
    );
    const footer = container.querySelector('footer') as HTMLElement;
    const column = footer.parentElement as HTMLElement;
    const paddedContent = column.firstElementChild as HTMLElement;

    expect(paddedContent.className).toContain('kade-content-padding');
    expect(paddedContent.contains(footer)).toBe(false);
    expect(footer.style.paddingBottom).toBe('18px');
    // The <main> that holds the container must not be a padded column itself:
    // that was the merge bug, and it applied the padding a third time.
    const main = column.parentElement as HTMLElement;
    expect(main.className ?? '').not.toContain('kade-content');
  });

  it('renders exactly once from the shared shell, with a dynamic year', () => {
    const { container } = render(
      <AppShell network="Ethereum Sepolia">
        <div>content</div>
      </AppShell>,
    );

    // The footer is global: the shell renders it once, not per route.
    const footers = container.querySelectorAll('footer');
    expect(footers).toHaveLength(1);

    const footer = footers[0] as HTMLElement;
    // The year is computed at render time, never hard-coded.
    expect(footer).toHaveTextContent(
      `© ${new Date().getFullYear()} EcoLabs B.V.`,
    );
    expect(footer).toHaveTextContent('Willemstad, Curaçao');
    expect(footer).toHaveTextContent('Privacy');
    expect(footer).toHaveTextContent('Terms');
    // Privacy links to the in-app policy route. Terms is still a plain label:
    // exactly one anchor, and it must be the Privacy link (no invented href, and
    // never "#").
    const link = footer.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).toHaveTextContent('Privacy');
    expect(link?.getAttribute('href')).toBe('/privacy');
    expect(footer.querySelectorAll('a')).toHaveLength(1);
  });
});
