/**
 * SECURITY: Layer 3 — API route admin guard.
 * Import and call requireAdmin() as the FIRST LINE of any admin-only API handler.
 * Returns 401 if unauthenticated, 403 if authenticated but not admin.
 * See docs/access-control.md for the full access control architecture.
 */

import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';

export type RequireAdminResult =
  | { error: NextResponse }
  | { companyId: string; userId: string };

export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: sessionError
  } = await supabase.auth.getUser();

  if (sessionError || !user) {
    return {
      error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    };
  }

  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('role, company_id')
    .eq('id', user.id)
    .maybeSingle();

  if (accountError) {
    return {
      error: NextResponse.json({ error: accountError.message }, { status: 500 })
    };
  }

  if (
    account?.role !== 'admin' ||
    account.company_id == null ||
    account.company_id === ''
  ) {
    return {
      error: NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    };
  }

  return { companyId: account.company_id, userId: user.id };
}

/**
 * Server Component / RSC helper — enforces admin session with `redirect()`, not `NextResponse`.
 * Do not use in Route Handlers; use `requireAdmin()` there.
 */
export async function assertAdminOrRedirect(): Promise<{
  companyId: string;
  userId: string;
}> {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/sign-in');
  }

  const { data: account } = await supabase
    .from('accounts')
    .select('role, company_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!account?.role) {
    redirect('/auth/sign-in');
  }

  if (
    account.role !== 'admin' ||
    account.company_id == null ||
    account.company_id === ''
  ) {
    redirect('/driver/shift');
  }

  return { companyId: account.company_id, userId: user.id };
}
