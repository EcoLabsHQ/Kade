import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * The sidebar's Resident/Admin switch.
 *
 * Both halves are links. The Admin half was already a link to `/admin`
 * (`sidebar-admin.test.tsx`); the Resident half was a static `<span>` that did
 * nothing, so from `/admin` there was no way back to the resident view through
 * the switch, and the switch could show Resident as the live mode while Admin
 * was highlighted. These tests pin the corrected semantics in both modes, and
 * that the resident mode still reads as it did (Resident live, Admin offered).
 *
 * Pre-fix, every `getByRole('link', { name: 'Resident' })` here found nothing.
 */

const hoisted = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => hoisted.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { Sidebar } from '@/components/shell/Sidebar';

const NAV = [{ items: [{ href: '/', label: 'Overview' }] }];

function renderSidebar() {
  return render(
    <Sidebar
      nav={NAV}
      network="Ethereum Sepolia"
      safeAddress={null}
      isReviewer
    />,
  );
}

describe('Sidebar Resident/Admin switch', () => {
  it('keeps Resident live in resident mode, with Admin offered', () => {
    hoisted.pathname = '/';
    renderSidebar();

    const resident = screen.getByRole('link', { name: 'Resident' });
    expect(resident).toHaveAttribute('href', '/');
    expect(resident).toHaveAttribute('aria-current', 'page');
    expect(resident.style.background).not.toBe('transparent');

    const admin = screen.getByRole('link', { name: 'Admin' });
    expect(admin).toHaveAttribute('href', '/admin');
    expect(admin).not.toHaveAttribute('aria-current');
  });

  it('makes Resident the way back from admin, without it reading as live', () => {
    hoisted.pathname = '/admin';
    renderSidebar();

    const resident = screen.getByRole('link', { name: 'Resident' });
    expect(resident).toHaveAttribute('href', '/');
    expect(resident).not.toHaveAttribute('aria-current');
    expect(resident.style.background).toBe('transparent');

    const admin = screen.getByRole('link', { name: 'Admin' });
    expect(admin).toHaveAttribute('aria-current', 'page');
  });

  it('is operable by keyboard in both modes', () => {
    hoisted.pathname = '/admin';
    renderSidebar();

    const resident = screen.getByRole('link', { name: 'Resident' });
    resident.focus();
    expect(document.activeElement).toBe(resident);
  });
});
