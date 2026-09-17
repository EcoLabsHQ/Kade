import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isAuthConfigured, readAuthEnv } from '@/lib/env';

export interface SessionRefreshResult {
  readonly response: NextResponse;
  readonly userId: string | null;
  readonly configured: boolean;
}

/**
 * Middleware-refresh pattern for @supabase/ssr.
 *
 * Refreshes the auth cookies on every matched request and returns the
 * authenticated user id. When Supabase is not configured it returns a
 * pass-through response with `configured: false`; the route policy then
 * decides what to do and no client is constructed.
 */
export async function updateSession(
  request: NextRequest,
): Promise<SessionRefreshResult> {
  const env = readAuthEnv();
  if (!isAuthConfigured(env)) {
    return {
      response: NextResponse.next({ request }),
      userId: null,
      configured: false,
    };
  }

  let response = NextResponse.next({ request });

  try {
    const supabase = createServerClient(
      env.supabaseUrl as string,
      env.supabaseAnonKey as string,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => {
              request.cookies.set(name, value);
            });
            response = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      },
    );

    const { data } = await supabase.auth.getUser();
    return { response, userId: data.user?.id ?? null, configured: true };
  } catch {
    // A present-but-unusable configuration is treated as not configured so the
    // request degrades to the readable login error state instead of a 500.
    return {
      response: NextResponse.next({ request }),
      userId: null,
      configured: false,
    };
  }
}
