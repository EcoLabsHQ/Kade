import { NextResponse, type NextRequest } from 'next/server';
import { resolveAccess } from '@/lib/routing';
import { updateSession } from '@/lib/supabase/middleware';

/**
 * D3: every app route is protected. An unauthenticated request is redirected
 * to /login. When Supabase is not configured the redirect carries
 * `?reason=not-configured` so the login screen can explain the missing setup
 * instead of failing.
 */
export async function middleware(request: NextRequest) {
  const { response, userId, configured } = await updateSession(request);

  const decision = resolveAccess(request.nextUrl.pathname, {
    configured,
    userId,
  });

  if (decision.kind === 'redirect') {
    const url = request.nextUrl.clone();
    url.pathname = decision.to;
    url.search = decision.query;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
