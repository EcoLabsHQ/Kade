import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { NavItem } from '@/components/shell/NavItem';
import { setColosseumAttention } from '@/components/shell/colosseum-attention';
import { RESIDENT_NAV } from '@/components/shell/nav';
import { tokens } from '@/components/ui/tokens';

/**
 * The Residency nav item carries the Colosseum demo highlight only while
 * "Become a Citizen" is available. Every other nav item is unchanged.
 */

const residency = RESIDENT_NAV.flatMap((group) => group.items).find(
  (item) => item.href === '/residency',
)!;
const holdings = RESIDENT_NAV.flatMap((group) => group.items).find(
  (item) => item.href === '/holdings',
)!;

beforeEach(() => {
  window.localStorage.clear();
  act(() => setColosseumAttention(false));
});

afterEach(() => {
  cleanup();
  act(() => setColosseumAttention(false));
  window.localStorage.clear();
});

describe('NavItem — the Colosseum highlight', () => {
  it('renders the Residency item normally when there is nothing to do', () => {
    render(<NavItem item={residency} active={false} />);

    const link = screen.getByRole('link', { name: /residency/i });
    expect(link).not.toHaveAttribute('data-colosseum-attention');
    expect(link).not.toHaveClass('kade-nav-attention');
  });

  it('highlights the Residency item when attention is set', () => {
    render(<NavItem item={residency} active={false} />);

    act(() => setColosseumAttention(true));

    const link = screen.getByRole('link', { name: /residency/i });
    expect(link).toHaveAttribute('data-colosseum-attention', 'true');
    expect(link).toHaveClass('kade-nav-attention');
  });

  it('carries the breathing dot the nav stylesheet animates, not a halo', () => {
    render(<NavItem item={residency} active={false} />);

    act(() => setColosseumAttention(true));

    const link = screen.getByRole('link', { name: /residency/i });
    // The attention class is the stylesheet hook; the dot inside it is what
    // breathes (`globals.css` targets `.kade-nav-attention .kade-nav-dot`).
    expect(link).toHaveClass('kade-nav-attention');
    expect(link.querySelector('.kade-nav-dot')).not.toBeNull();
  });

  it('clears the highlight when attention is cleared', () => {
    render(<NavItem item={residency} active={false} />);

    act(() => setColosseumAttention(true));
    expect(
      screen.getByRole('link', { name: /residency/i }),
    ).toHaveAttribute('data-colosseum-attention', 'true');

    act(() => setColosseumAttention(false));
    expect(
      screen.getByRole('link', { name: /residency/i }),
    ).not.toHaveAttribute('data-colosseum-attention');
  });

  it('never highlights another nav item', () => {
    render(<NavItem item={holdings} active={false} />);

    act(() => setColosseumAttention(true));

    expect(
      screen.getByRole('link', { name: /holdings/i }),
    ).not.toHaveAttribute('data-colosseum-attention');
  });
});

/**
 * The counter-finished notification: when citizenship becomes claimable the nav
 * does not go blue — the Residency item's existing dot turns red, and the
 * claimable state is announced, not left to colour alone.
 */
describe('NavItem — the Colosseum red claim dot', () => {
  it('turns the existing dot red instead of taking the brand highlight', () => {
    render(<NavItem item={residency} active={false} />);

    act(() => setColosseumAttention(true));

    const link = screen.getByRole('link', { name: /residency/i });
    expect(link).toHaveAttribute('data-colosseum-attention', 'true');
    // No brand/blue presentation: the row stays a plain inactive row.
    expect(link).toHaveStyle({ background: 'transparent' });
    expect(link.style.background).not.toBe('#E6F1FE');

    const dot = link.querySelector('.kade-nav-dot') as HTMLElement;
    expect(dot).not.toBeNull();
    // The same 5px nav dot vocabulary, grown and coloured for a notification.
    expect(dot).toHaveAttribute('data-colosseum-claimable-dot', 'true');
    expect(dot.style.background).toBe('rgb(180, 35, 24)');
    expect(dot.style.boxShadow).not.toBe('');
  });

  it('announces the claimable state to assistive tech, not by colour alone', () => {
    render(<NavItem item={residency} active={false} />);

    act(() => setColosseumAttention(true));

    expect(
      screen.getByRole('link', {
        name: /residency.*citizenship can now be claimed/i,
      }),
    ).toBeInTheDocument();
  });

  it('keeps the active row and its background while showing the red dot', () => {
    render(<NavItem item={residency} active />);

    act(() => setColosseumAttention(true));

    const link = screen.getByRole('link', { name: /residency/i });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(link).toHaveStyle({ background: tokens.activeNavBg });
    const dot = link.querySelector('.kade-nav-dot') as HTMLElement;
    expect(dot.style.background).toBe('rgb(180, 35, 24)');
  });

  it('returns the dot to the resting nav style when the notice is cleared', () => {
    render(<NavItem item={residency} active={false} />);

    act(() => setColosseumAttention(true));
    act(() => setColosseumAttention(false));

    const link = screen.getByRole('link', { name: /residency/i });
    expect(link).not.toHaveAttribute('data-colosseum-attention');
    const dot = link.querySelector('.kade-nav-dot') as HTMLElement;
    expect(dot).not.toHaveAttribute('data-colosseum-claimable-dot');
    expect(dot.style.background).not.toBe('rgb(180, 35, 24)');
  });
});
