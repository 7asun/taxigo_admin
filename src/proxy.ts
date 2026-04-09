import { createServerClient } from '@supabase/ssr';
import type { CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
    );
  }

  return { url, anonKey };
}

export async function proxy(request: NextRequest) {
  const { url, anonKey } = getSupabaseEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options?: CookieOptions }[]
      ) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isDashboardRoute = pathname.startsWith('/dashboard');
  const isDriverRoute = pathname.startsWith('/driver');
  const isAuthRoute = pathname.startsWith('/auth');

  // SECURITY: Load user role to enforce route-level access control.
  // Drivers must never reach /dashboard; admins must never reach /driver.
  // This is Layer 1 of 5 — see docs/access-control.md
  let userRole: string | null = null;
  if (user && (isDashboardRoute || isDriverRoute || isAuthRoute)) {
    const { data: account } = await supabase
      .from('accounts')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();
    userRole = account?.role ?? null;
  }

  if ((isDashboardRoute || isDriverRoute) && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/auth/sign-in';
    redirectUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (isDashboardRoute && user && userRole === 'driver') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/driver/shift';
    return NextResponse.redirect(redirectUrl);
  }

  if (isDriverRoute && user && userRole !== 'driver') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/dashboard/overview';
    return NextResponse.redirect(redirectUrl);
  }

  if (isAuthRoute && user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname =
      userRole === 'driver' ? '/driver/shift' : '/dashboard/overview';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)'
  ]
};
