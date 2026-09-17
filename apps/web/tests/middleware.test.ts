// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const hoisted = vi.hoisted(() => ({ updateSession: vi.fn() }));

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: hoisted.updateSession,
}));

import { middleware } from '@/middleware';

function request(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

describe('middleware protected-route enforcement', () => {
  beforeEach(() => {
    hoisted.updateSession.mockReset();
  });

  it('redirects an unauthenticated request for a protected route to /login', async () => {
    hoisted.updateSession.mockResolvedValue({
      response: NextResponse.next(),
      userId: null,
      configured: true,
    });

    const response = await middleware(request('/'));
    const location = new URL(response.headers.get('location') ?? '');

    expect(response.status).toBe(307);
    expect(location.pathname).toBe('/login');
    expect(location.search).toBe('?next=%2F');
  });

  it('reports the missing configuration rather than crashing', async () => {
    hoisted.updateSession.mockResolvedValue({
      response: NextResponse.next(),
      userId: null,
      configured: false,
    });

    const response = await middleware(request('/account'));
    const location = new URL(response.headers.get('location') ?? '');

    expect(location.pathname).toBe('/login');
    expect(location.search).toBe('?reason=not-configured');
  });

  it('lets an authenticated request through without redirecting', async () => {
    hoisted.updateSession.mockResolvedValue({
      response: NextResponse.next(),
      userId: 'user-1',
      configured: true,
    });

    const response = await middleware(request('/account'));

    expect(response.headers.get('location')).toBeNull();
  });

  it('does not redirect a public route', async () => {
    hoisted.updateSession.mockResolvedValue({
      response: NextResponse.next(),
      userId: null,
      configured: true,
    });

    const response = await middleware(request('/login'));

    expect(response.headers.get('location')).toBeNull();
  });
});
