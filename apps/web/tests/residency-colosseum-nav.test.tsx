import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { NavItem } from '@/components/shell/NavItem';
import { setColosseumAttention } from '@/components/shell/colosseum-attention';
import { RESIDENT_NAV } from '@/components/shell/nav';

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
