/** SECURITY: Layer 3 — requireAdmin(); see docs/access-control.md */

/**
 * GET /api/users — company accounts merged with live auth emails.
 *
 * Legacy (no page/perPage): flat CompanyUser[] for /dashboard/users.
 * Paginated (both page and perPage): { data, totalItems } for driver roster table.
 */
import { requireAdmin } from '@/lib/api/require-admin';
import {
  getRoster,
  mergeLiveEmails
} from '@/features/driver-management/api/get-roster';
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ('error' in auth) {
    return auth.error;
  }

  const { searchParams } = request.nextUrl;
  const pageParam = searchParams.get('page');
  const perPageParam = searchParams.get('perPage');
  const isPaginated = pageParam != null && perPageParam != null;

  const sessionSupabase = await createClient();

  if (!isPaginated) {
    const { data: rows, error: rowsError } = await sessionSupabase
      .from('accounts')
      .select(
        'id, name, first_name, last_name, role, is_active, created_at, phone'
      )
      .eq('company_id', auth.companyId)
      .order('name', { ascending: true });

    if (rowsError) {
      return NextResponse.json({ error: rowsError.message }, { status: 500 });
    }

    const merged = await mergeLiveEmails(rows ?? []);
    return NextResponse.json(merged);
  }

  const page = Math.max(1, parseInt(pageParam, 10) || 1);
  const perPage = Math.max(1, parseInt(perPageParam, 10) || 10);
  const role = searchParams.get('role') ?? undefined;
  const search =
    searchParams.get('search') ?? searchParams.get('name') ?? undefined;
  const sortParam = searchParams.get('sort');

  try {
    const result = await getRoster({
      page,
      perPage,
      role:
        role === 'driver' || role === 'admin' || role === 'all'
          ? role
          : undefined,
      search: search ?? undefined,
      sort: sortParam,
      companyId: auth.companyId
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
