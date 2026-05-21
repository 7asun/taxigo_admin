/** SECURITY: Layer 3 — requireAdmin(); see docs/access-control.md */

/**
 * GET /api/users — all accounts in the admin's company merged with live auth emails.
 */
import { requireAdmin } from '@/lib/api/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { CompanyUser } from '@/features/user-management/types';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireAdmin();
  if ('error' in auth) {
    return auth.error;
  }

  const sessionSupabase = await createClient();
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

  const admin = createAdminClient();

  const merged: CompanyUser[] = await Promise.all(
    (rows ?? []).map(async (row) => {
      const { data: authUserResult } = await admin.auth.admin.getUserById(
        row.id
      );
      const email = authUserResult?.user?.email ?? null;
      return {
        id: row.id,
        name: row.name,
        first_name: row.first_name,
        last_name: row.last_name,
        email,
        role: row.role,
        is_active: row.is_active,
        created_at: row.created_at,
        phone: row.phone
      };
    })
  );

  return NextResponse.json(merged);
}
