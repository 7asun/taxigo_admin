/**
 * RSC: fetches KTS Abrechnung groups server-side via get_kts_abrechnung_groups RPC.
 * why: grouped by kts_belegnummer — separate from Bearbeitung trip queue listing.
 */
import { searchParamsCache } from '@/lib/searchparams';
import { createClient } from '@/lib/supabase/server';
import { toQueryError } from '@/lib/supabase/to-query-error';
import { assertAdminOrRedirect } from '@/lib/api/require-admin';
import { KtsAbrechnungFiltersBar } from '@/features/kts/components/kts-abrechnung-filters-bar';
import { KtsAbrechnungTable } from '@/features/kts/components/kts-abrechnung-table';
import {
  fetchKtsAbrechnungGroups,
  fetchKtsAbrechnungGroupsCount
} from '@/features/kts/kts.service';
import type { KtsAbrechnungGroup } from '@/features/kts/types/kts-abrechnung-group';
import type { AbrechnungGroupStatus } from '@/lib/kts-status';
import type { SearchParams } from 'nuqs/server';

const DEFAULT_ABRECHNUNG_STATUSES: AbrechnungGroupStatus[] = [
  'abgerechnet',
  'ruecklaufer'
];

type KtsAbrechnungListingPageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function KtsAbrechnungListingPage({
  searchParams
}: KtsAbrechnungListingPageProps) {
  await searchParamsCache.parse(searchParams);

  const page = searchParamsCache.get('page');
  const pageLimit = searchParamsCache.get('perPage');
  const search = searchParamsCache.get('search');
  const importedFrom = searchParamsCache.get('imported_from');
  const importedTo = searchParamsCache.get('imported_to');

  const rawStatusFilter = searchParamsCache.get('kts_status');
  const statusFilter: string[] =
    rawStatusFilter && rawStatusFilter.length > 0
      ? rawStatusFilter
      : DEFAULT_ABRECHNUNG_STATUSES;

  const { companyId } = await assertAdminOrRedirect();
  const supabase = await createClient();

  const offset = page && pageLimit ? (page - 1) * pageLimit : 0;
  const limit = pageLimit ?? 50;

  const rpcPayload = {
    companyId,
    statusFilter,
    search: search ?? null,
    importedFrom: importedFrom ?? null,
    importedTo: importedTo ?? null
  };

  let groups: KtsAbrechnungGroup[] = [];
  let totalGroups = 0;

  try {
    const [rows, count] = await Promise.all([
      fetchKtsAbrechnungGroups(supabase, {
        ...rpcPayload,
        limit,
        offset
      }),
      fetchKtsAbrechnungGroupsCount(supabase, rpcPayload)
    ]);

    groups = rows.map((row) => ({
      kts_belegnummer: row.kts_belegnummer,
      trip_count: Number(row.trip_count ?? 0),
      gesamtbetrag: Number(row.gesamtbetrag ?? 0),
      eigenanteil_gesamt: Number(row.eigenanteil_gesamt ?? 0),
      earliest_trip: row.earliest_trip,
      latest_trip: row.latest_trip,
      import_id: row.import_id,
      source_filename: row.source_filename,
      imported_at: row.imported_at,
      import_count: Number(row.import_count ?? 0),
      has_multiple_imports: Boolean(row.has_multiple_imports),
      group_status: row.group_status as AbrechnungGroupStatus
    }));
    totalGroups = count;
  } catch (error) {
    throw toQueryError(error);
  }

  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col space-y-4 overflow-hidden'>
      <KtsAbrechnungFiltersBar totalItems={totalGroups} />
      <KtsAbrechnungTable data={groups} totalItems={totalGroups} />
    </div>
  );
}
