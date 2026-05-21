'use server';

/**
 * Direct server-side roster query — bypasses HTTP fetch in RSC.
 * RSC calling its own Route Handler via fetch() fails in Node because
 * relative URLs have no base. Shared data layer for GET /api/users (paginated)
 * and DriverTableListing.
 */

import { requireAdmin } from '@/lib/api/require-admin';
import { getSortingStateParser } from '@/lib/parsers';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { DriverWithProfile } from '@/features/driver-management/types';

const SORTABLE_COLUMNS = new Set([
  'name',
  'first_name',
  'last_name',
  'email',
  'role',
  'phone',
  'is_active',
  'company_id'
]);

type AccountRow = {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  role: string;
  is_active: boolean | null;
  created_at: string | null;
  phone: string | null;
};

export interface GetRosterParams {
  page: number;
  perPage: number;
  role?: 'all' | 'driver' | 'admin';
  search?: string;
  sort?: string | null;
  companyId: string;
}

export interface RosterRow {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  role: string;
  is_active: boolean | null;
  created_at: string | null;
  phone: string | null;
}

export interface RosterResult {
  data: RosterRow[];
  totalItems: number;
}

export async function mergeLiveEmails(
  rows: AccountRow[]
): Promise<RosterRow[]> {
  const admin = createAdminClient();
  return Promise.all(
    rows.map(async (row) => {
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
}

export async function getRoster(
  params: GetRosterParams
): Promise<RosterResult> {
  const sessionSupabase = await createClient();

  let query = sessionSupabase
    .from('accounts')
    .select(
      'id, name, first_name, last_name, role, is_active, created_at, phone',
      { count: 'exact' }
    )
    .eq('company_id', params.companyId);

  if (params.role && params.role !== 'all') {
    query = query.eq('role', params.role);
  }

  if (params.search) {
    const term = `%${params.search}%`;
    query = query.or(
      `name.ilike.${term},first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term}`
    );
  }

  const parsed =
    getSortingStateParser().parseServerSide(params.sort ?? undefined) || [];
  const sorting = parsed.filter(
    (s: { id: string; desc: boolean }) =>
      s?.id && typeof s.id === 'string' && SORTABLE_COLUMNS.has(s.id)
  );
  if (sorting.length > 0) {
    sorting.forEach((sortRule: { id: string; desc: boolean }) => {
      query = query.order(sortRule.id, { ascending: !sortRule.desc });
    });
  } else {
    query = query.order('name', { ascending: true });
  }

  const from = (params.page - 1) * params.perPage;
  const to = from + params.perPage - 1;
  query = query.range(from, to);

  const { data: rows, count, error: rowsError } = await query;

  if (rowsError) {
    throw new Error(rowsError.message);
  }

  const merged = await mergeLiveEmails(rows ?? []);
  return {
    data: merged,
    totalItems: count ?? 0
  };
}

/**
 * Load one account + driver_profiles with live Auth email (column detail panel).
 */
export async function getDriverWithLiveEmail(
  id: string,
  companyId: string
): Promise<DriverWithProfile | null> {
  const sessionSupabase = await createClient();
  const { data: user, error: userError } = await sessionSupabase
    .from('accounts')
    .select('*')
    .eq('id', id)
    .eq('company_id', companyId)
    .maybeSingle();

  if (userError || !user) {
    return null;
  }

  const { data: profiles } = await sessionSupabase
    .from('driver_profiles')
    .select('*')
    .eq('user_id', id);

  const admin = createAdminClient();
  const { data: authUser } = await admin.auth.admin.getUserById(id);
  const liveEmail = authUser?.user?.email ?? user.email ?? null;

  return {
    ...user,
    email: liveEmail,
    driver_profiles: profiles ?? []
  } as DriverWithProfile;
}

/** Server Action — client column panel calls this instead of driversService.getDriverById. */
export async function loadDriverForPanel(
  driverId: string
): Promise<DriverWithProfile | null> {
  const auth = await requireAdmin();
  if ('error' in auth) {
    throw new Error('Unauthorized');
  }
  return getDriverWithLiveEmail(driverId, auth.companyId);
}
