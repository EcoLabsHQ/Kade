import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

/**
 * The shell's Admin switch.
 *
 * It is navigation only — RLS (`is_reviewer()`) is the real gate — so this
 * pins that a reviewer is offered the link and everyone else gets a disabled
 * label, and that the boolean cannot be flipped without a test failing.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

import { Sidebar } from '@/components/shell/Sidebar';

const NAV = [{ items: [{ href: '/', label: 'Overview' }] }];

function renderSidebar(isReviewer: boolean) {
  return render(
    <Sidebar
      nav={NAV}
      network="Ethereum Sepolia"
      safeAddress={null}
      email="resident@example.com"
      isReviewer={isReviewer}
    />,
  );
}

describe('Sidebar Admin switch', () => {
  it('links to /admin for a reviewer', () => {
    renderSidebar(true);
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'href',
      '/admin',
    );
    cleanup();
  });

  it('shows a disabled label for a non-reviewer', () => {
    renderSidebar(false);
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
    expect(screen.getByText('Admin')).toHaveAttribute('aria-disabled', 'true');
    cleanup();
  });
});
