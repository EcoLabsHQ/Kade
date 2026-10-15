import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrivacyScreen } from '@/components/legal/PrivacyScreen';
import { isProtectedPath, isPublicPath, resolveAccess } from '@/lib/routing';

/**
 * The public privacy policy page.
 *
 * It must be readable without a session (so the route is public and reads no
 * resident data) and must carry the hosting entity and the full postal address
 * the human supplied, plus the on-chain disclosure that public-chain records
 * cannot be deleted.
 */
describe('privacy policy page', () => {
  it('is reachable without a session, and its look-alikes stay protected', () => {
    expect(isPublicPath('/privacy')).toBe(true);
    expect(isProtectedPath('/privacy')).toBe(false);
    expect(
      resolveAccess('/privacy', { configured: false, userId: null }),
    ).toEqual({ kind: 'allow' });
    expect(isPublicPath('/privacy-evil')).toBe(false);
    expect(isPublicPath('/privacyxyz')).toBe(false);
  });

  it('renders the heading, the entity and the full address', () => {
    const { container } = render(<PrivacyScreen />);

    expect(
      screen.getByRole('heading', { name: 'Privacy Policy' }),
    ).toBeInTheDocument();

    const text = container.textContent ?? '';
    expect(text).toContain('EcoLabs B.V.');
    expect(text).toContain('Kaya Seru Cueba 20, 0000cw, Willemstad, Curaçao');
  });

  it('discloses that on-chain records cannot be deleted or altered', () => {
    const { container } = render(<PrivacyScreen />);
    const text = container.textContent ?? '';

    expect(text).toContain('public blockchains');
    expect(text).toContain('cannot be deleted or altered');
  });
});
