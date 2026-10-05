import { describe, expect, it } from 'vitest';
import {
  isProtectedPath,
  isPublicPath,
  resolveAccess,
} from '@/lib/routing';

/**
 * Crawlers and browsers must be able to fetch the Next.js metadata routes
 * `/robots.txt` and `/manifest.webmanifest` without a session. These are
 * static, non-sensitive files; the app stays `noindex`, so exposing them does
 * not make any resident route indexable.
 *
 * The exemption is exact-path only: it must not leak to look-alike siblings or
 * broaden to any resident route.
 */
describe('metadata route policy', () => {
  it('serves robots.txt and manifest.webmanifest without a session', () => {
    expect(isPublicPath('/robots.txt')).toBe(true);
    expect(isPublicPath('/manifest.webmanifest')).toBe(true);
    expect(isProtectedPath('/robots.txt')).toBe(false);
    expect(isProtectedPath('/manifest.webmanifest')).toBe(false);
  });

  it('allows the metadata routes through regardless of session state', () => {
    expect(
      resolveAccess('/robots.txt', { configured: false, userId: null }),
    ).toEqual({ kind: 'allow' });
    expect(
      resolveAccess('/manifest.webmanifest', { configured: true, userId: null }),
    ).toEqual({ kind: 'allow' });
  });

  it('does not leak the exemption to look-alike siblings', () => {
    expect(isPublicPath('/robots.txt-evil')).toBe(false);
    expect(isPublicPath('/manifest.webmanifest-evil')).toBe(false);
    expect(isPublicPath('/robots')).toBe(false);
    expect(isPublicPath('/manifest')).toBe(false);
  });

  it('keeps resident and unknown routes protected', () => {
    for (const pathname of [
      '/',
      '/holdings',
      '/residency',
      '/account',
      '/onboarding',
      '/invest',
      '/unknown',
    ]) {
      expect(isPublicPath(pathname), `${pathname} must stay non-public`).toBe(
        false,
      );
      expect(
        isProtectedPath(pathname),
        `${pathname} must stay protected`,
      ).toBe(true);
    }
  });
});
