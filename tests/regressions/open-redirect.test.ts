/**
 * Regression: the post-authentication open redirect.
 *
 * This failed before.
 *
 * The OAuth callback and the login page both validated the `next` return path
 * with a string prefix check:
 *
 *     next.startsWith('/') && !next.startsWith('//')
 *
 * URL parsers normalise a backslash to a path separator for special schemes, so
 * `next=/\evil.com` passed that check and `new URL('/\\evil.com', origin)`
 * resolved to `http://evil.com/`. An attacker could share
 * `https://<app>/login?next=/\evil.com`; the resident signed in with Google
 * normally and was then redirected to the attacker's origin, with the trust of
 * having just authenticated. No test covered `next`, so it shipped.
 *
 * This must continue working.
 *
 * The suite lives here, not beside the helper, because the development contract
 * requires regression coverage in tests/regressions/ and because it must be
 * visible to the regression gate in scripts/verify.sh.
 */

import { describe, expect, it } from 'vitest';
import { resolveSafeReturnPath } from '../../apps/web/src/lib/safe-redirect';

const TRUSTED_ORIGIN = 'https://app.kade.test';

describe('regression: open redirect via the post-auth return path', () => {
  it('rejects the backslash bypass that defeated the prefix check', () => {
    // The exact input that resolved off-origin before this was fixed.
    expect(resolveSafeReturnPath('/\\evil.com', TRUSTED_ORIGIN)).toBe('/');
  });

  it('rejects every encoding of the bypass', () => {
    for (const candidate of [
      '/\\evil.com',
      '/\\/evil.com',
      '\\\\evil.com',
      '/%5Cevil.com',
      '/%2F%2Fevil.com',
    ]) {
      const resolved = resolveSafeReturnPath(candidate, TRUSTED_ORIGIN);
      expect(resolved).toBe('/');
      expect(new URL(resolved, TRUSTED_ORIGIN).origin).toBe(TRUSTED_ORIGIN);
    }
  });

  it('rejects protocol-relative and absolute targets', () => {
    for (const candidate of ['//evil.com', 'https://evil.com', 'http://evil.com']) {
      expect(resolveSafeReturnPath(candidate, TRUSTED_ORIGIN)).toBe('/');
    }
  });

  it('still allows an ordinary in-app path', () => {
    // The fix must not break the feature it protects.
    expect(resolveSafeReturnPath('/onboarding?step=2', TRUSTED_ORIGIN)).toBe(
      '/onboarding?step=2',
    );
  });
});
