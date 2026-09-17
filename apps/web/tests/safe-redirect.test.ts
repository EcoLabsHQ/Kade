import { describe, expect, it } from 'vitest';
import { resolveSafeReturnPath } from '@/lib/safe-redirect';

const ORIGIN = 'https://app.kade.test';

/**
 * Regression tests for the open-redirect guard bypass.
 *
 * Before the fix, both the login page and the OAuth callback decided safety with
 * `startsWith('/') && !startsWith('//')`. That accepts `/\evil.com`, which the
 * URL parser normalises to a protocol-relative URL and which therefore resolves
 * to a different origin after authentication.
 *
 * These cases must never resolve off-origin.
 */
describe('resolveSafeReturnPath', () => {
  it('keeps an ordinary in-app path', () => {
    expect(resolveSafeReturnPath('/dashboard', ORIGIN)).toBe('/dashboard');
  });

  it('keeps a path with a query string and fragment', () => {
    expect(resolveSafeReturnPath('/onboarding?step=2#fee', ORIGIN)).toBe(
      '/onboarding?step=2#fee',
    );
  });

  describe('off-origin attempts', () => {
    const attempts: Record<string, string> = {
      'protocol-relative': '//evil.com',
      'backslash prefix': '/\\evil.com',
      'backslash then slash': '/\\/evil.com',
      'double backslash': '\\\\evil.com',
      'absolute https url': 'https://evil.com',
      'absolute http url': 'http://evil.com',
      'scheme-relative with port': '//evil.com:443/path',
      'leading whitespace then backslash': '  /\\evil.com  ',
      'encoded slash slash': '/%2F%2Fevil.com',
      'encoded backslash': '/%5Cevil.com',
      'mixed encoded backslash': '/a%5Cb',
    };

    for (const [name, value] of Object.entries(attempts)) {
      it(`rejects ${name} (${value})`, () => {
        expect(resolveSafeReturnPath(value, ORIGIN)).toBe('/');
      });
    }
  });

  it('rejects a candidate that already carries the trusted origin followed by a backslash', () => {
    expect(resolveSafeReturnPath(`https://app.kade.test/\\evil.com`, ORIGIN)).toBe('/');
  });

  it('falls back for empty, missing or non-string input', () => {
    expect(resolveSafeReturnPath('', ORIGIN)).toBe('/');
    expect(resolveSafeReturnPath('   ', ORIGIN)).toBe('/');
    expect(resolveSafeReturnPath(null, ORIGIN)).toBe('/');
    expect(resolveSafeReturnPath(undefined, ORIGIN)).toBe('/');
  });

  it('uses the supplied fallback', () => {
    expect(resolveSafeReturnPath('//evil.com', ORIGIN, '/login')).toBe('/login');
  });

  it('resolves against a trusted origin with a base path', () => {
    expect(resolveSafeReturnPath('/dashboard', 'https://app.kade.test')).toBe('/dashboard');
  });
});
