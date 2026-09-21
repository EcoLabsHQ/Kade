import { describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { ContentContainer } from '@/components/shell/ContentContainer';
import { LoginScreen } from '@/components/auth/LoginScreen';

vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signInWithOAuth: vi.fn(),
      signInWithOtp: vi.fn(),
    },
  }),
}));

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

    // The 64px gap belongs to the content column, so it stays above the footer.
    expect(paddedContent.style.paddingBottom).toBe('64px');
    // The footer is a sibling of the padded content, never inside its padding,
    // so the container's 64px can never stack underneath the footer.
    expect(paddedContent.contains(footer)).toBe(false);
    expect(footer.parentElement).toBe(column);
    // The gap below the footer is the footer's own fixed value.
    expect(footer.style.paddingBottom).toBe('18px');
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

    expect(paddedContent.style.paddingBottom).toBe('64px');
    expect(paddedContent.contains(footer)).toBe(false);
    expect(footer.style.paddingBottom).toBe('18px');
  });
});
