import { describe, expect, it } from 'vitest';
import { isProtectedPath, isPublicPath, resolveAccess } from '@/lib/routing';

/**
 * D16: the Self webhook is called server-to-server and carries no resident
 * session, so `/api/webhooks` must be public or the middleware would redirect
 * the provider to `/login` and the event would never arrive. The exemption is
 * deliberately narrower than `/api`.
 */

describe('webhook routing', () => {
  it('treats the Self webhook as public', () => {
    expect(isPublicPath('/api/webhooks/self')).toBe(true);
    expect(isPublicPath('/api/webhooks')).toBe(true);
    expect(isPublicPath('/api/webhooks/self/extra')).toBe(true);
  });

  it('does not exempt the rest of /api', () => {
    expect(isPublicPath('/api')).toBe(false);
    expect(isPublicPath('/api/other')).toBe(false);
    // A prefix match must not leak to a sibling that merely shares the text.
    expect(isPublicPath('/api/webhooks-evil')).toBe(false);
  });

  it('allows a webhook request through the middleware with no session', () => {
    expect(
      resolveAccess('/api/webhooks/self', { configured: false, userId: null }),
    ).toEqual({ kind: 'allow' });
    expect(
      resolveAccess('/api/webhooks/self', { configured: true, userId: null }),
    ).toEqual({ kind: 'allow' });
  });

  it('leaves non-webhook routes protected', () => {
    expect(isProtectedPath('/account')).toBe(true);
    expect(isProtectedPath('/api/other')).toBe(true);
  });
});
