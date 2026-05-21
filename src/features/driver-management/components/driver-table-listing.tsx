/**
 * DriverTableListing — Server component for table view.
 *
 * Fetches roster via getRoster() (direct server query, no HTTP fetch).
 * Uses searchParamsCache (populated by page) for page, perPage, name, role, sort.
 * Rendered at /dashboard/users when view=table.
 */

import { getRoster } from '@/features/driver-management/api/get-roster';
import { requireAdmin } from '@/lib/api/require-admin';
import { searchParamsCache } from '@/lib/searchparams';
import { DriverTable } from './drivers-table';
import type { DriverWithProfile } from '@/features/driver-management/types';

export default async function DriverTableListing() {
  const auth = await requireAdmin();
  if ('error' in auth) {
    throw new Error('Konten konnten nicht geladen werden: Nicht autorisiert');
  }

  const page = searchParamsCache.get('page') ?? 1;
  const perPage = searchParamsCache.get('perPage') ?? 10;
  const search =
    searchParamsCache.get('name') ?? searchParamsCache.get('search');
  const roleParam = searchParamsCache.get('role') ?? 'all';
  const role =
    roleParam === 'driver' || roleParam === 'admin' || roleParam === 'all'
      ? roleParam
      : 'all';
  const sortParam = searchParamsCache.get('sort');

  const { data, totalItems } = await getRoster({
    page,
    perPage,
    role,
    search: search ?? undefined,
    sort: sortParam,
    companyId: auth.companyId
  });

  return (
    <DriverTable data={data as DriverWithProfile[]} totalItems={totalItems} />
  );
}
