/**
 * RSC: fetches KTS trip queue server-side.
 * Forced kts_document_applies = true — exclusively for the KTS processing queue.
 * company_id scoped by RLS (matches trips-listing.tsx).
 */
import { searchParamsCache } from '@/lib/searchparams';
import { createClient } from '@/lib/supabase/server';
import { toQueryError } from '@/lib/supabase/to-query-error';
import { KtsFiltersBar } from '@/features/kts/components/kts-filters-bar';
import { KtsTable } from '@/features/kts/components/kts-table';
import type { KtsTripRow } from '@/features/kts/types/kts-trip-row';
import { KTS_OVERDUE_DAYS } from '@/features/kts/kts.service';
import type { SearchParams } from 'nuqs/server';

type KtsListingPageProps = {
  searchParams: Promise<SearchParams>;
};

export default async function KtsListingPage({
  searchParams
}: KtsListingPageProps) {
  await searchParamsCache.parse(searchParams);

  const page = searchParamsCache.get('page');
  const pageLimit = searchParamsCache.get('perPage');
  const ktsStatusValues = searchParamsCache.get('kts_status') ?? [];
  const search = searchParamsCache.get('search');
  const overdue = searchParamsCache.get('overdue') ?? false;

  const supabase = await createClient();

  // why: embed kts_corrections incl. id — required for receiveKtsCorrection + in_korrektur aging.
  const ktsListSelect = `
    *,
    kts_corrections(id, sent_at, received_at, sent_to)
  `;

  let trips: KtsTripRow[] = [];
  let totalTrips = 0;

  let skipTripsQuery = false;
  let overdueTripIds: string[] | null = null;

  if (overdue) {
    const cutoff = new Date(
      Date.now() - KTS_OVERDUE_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();

    // why: two-query overdue filter — PostgREST embed date filters are unreliable across versions.
    const { data: overdueRows, error: overdueError } = await supabase
      .from('kts_corrections')
      .select('trip_id')
      .is('received_at', null)
      .lt('sent_at', cutoff);

    if (overdueError) throw toQueryError(overdueError);

    overdueTripIds = [...new Set((overdueRows ?? []).map((r) => r.trip_id))];

    if (overdueTripIds.length === 0) {
      skipTripsQuery = true;
    }
  }

  if (!skipTripsQuery) {
    let query = supabase
      .from('trips')
      .select(ktsListSelect, { count: 'exact' })
      .eq('kts_document_applies', true);

    if (overdue && overdueTripIds) {
      query = query.eq('kts_status', 'in_korrektur').in('id', overdueTripIds);
    } else if (ktsStatusValues.length > 0) {
      query = query.in('kts_status', ktsStatusValues);
    }

    if (search) {
      const term = search.replace(/'/g, "''");
      query = query.or(
        `client_name.ilike.%${term}%,kts_patient_id.ilike.%${term}%`
      );
    }

    // why: no default date filter — queue shows full backlog, oldest first for chronological processing.
    query = query.order('scheduled_at', { ascending: true, nullsFirst: false });

    if (page && pageLimit) {
      const from = (page - 1) * pageLimit;
      const to = from + pageLimit - 1;
      query = query.range(from, to);
    }

    const { data, count, error } = await query;
    if (error) throw toQueryError(error);

    trips = (data ?? []) as unknown as KtsTripRow[];
    totalTrips = count ?? 0;
  }

  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col space-y-4 overflow-hidden'>
      <KtsFiltersBar totalItems={totalTrips} />
      <KtsTable data={trips} totalItems={totalTrips} />
    </div>
  );
}
