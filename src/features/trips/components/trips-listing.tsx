/**
 * Server component: loads trips for `/dashboard/trips` (Liste + Kanban).
 *
 * Date filtering is easy to get wrong: see `docs/trips-date-filter.md` for the
 * “stuck cards” incident (global `scheduled_at IS NULL` vs scoped unscheduled).
 */
import { searchParamsCache } from '@/lib/searchparams';
import { createClient } from '@/lib/supabase/server';
import { toQueryError } from '@/lib/supabase/to-query-error';
import { TripsTable, columns } from './trips-tables/index';
import { type TripListRow } from '../api/trips.service';
import { getSortingStateParser } from '@/lib/parsers';
import {
  TRIPS_SORT_MAP,
  TRIPS_SORTABLE_IDS
} from '@/features/trips/trips-sort-map';
import { TripsViewToggle } from './trips-view-toggle';
import { TripsKanbanBoard } from './trips-kanban-board';
import { TripsFiltersBar } from './trips-filters-bar';
import type { SearchParams } from 'nuqs/server';
import {
  getZonedDayBoundsIso,
  instantToYmdInBusinessTz,
  isYmdString,
  todayYmdInBusinessTz
} from '@/features/trips/lib/trip-business-date';
import type { EffectiveTripInvoiceStatus } from '@/features/trips/lib/effective-trip-invoice-status';
import { resolveInvoiceStatusTripFilter } from '@/features/trips/lib/resolve-invoice-status-trip-filter';

/** URL `invoice_status` values — pre-filter via `resolveInvoiceStatusTripFilter` (RPC). */
const INVOICE_STATUS_FILTER_VALUES = new Set([
  'uninvoiced',
  'draft',
  'sent',
  'paid'
]);

type TripsListingPageProps = {
  /** Same Promise as `page.tsx` — must be parsed in this async tree so filters match the URL. */
  searchParams: Promise<SearchParams>;
};

export default async function TripsListingPage({
  searchParams
}: TripsListingPageProps) {
  await searchParamsCache.parse(searchParams);

  const view = searchParamsCache.get('view') || 'list';
  const page = searchParamsCache.get('page');
  const pageLimit = searchParamsCache.get('perPage');

  // Trip filters
  const status = searchParamsCache.get('status');
  const driverId = searchParamsCache.get('driver_id');
  const payerId = searchParamsCache.get('payer_id');
  const billingVariantId = searchParamsCache.get('billing_variant_id');
  const search = searchParamsCache.get('search');
  const scheduledAt = searchParamsCache.get('scheduled_at');
  const invoiceStatus = searchParamsCache.get('invoice_status');
  const ktsFilter = searchParamsCache.get('kts_filter') ?? 'all';

  const supabase = await createClient();

  let invoiceTripFilter: Awaited<
    ReturnType<typeof resolveInvoiceStatusTripFilter>
  > | null = null;
  if (
    invoiceStatus &&
    invoiceStatus !== 'all' &&
    INVOICE_STATUS_FILTER_VALUES.has(invoiceStatus)
  ) {
    invoiceTripFilter = await resolveInvoiceStatusTripFilter(
      supabase,
      invoiceStatus as EffectiveTripInvoiceStatus
    );
  }

  const skipTripsQuery =
    invoiceTripFilter?.kind === 'in' && invoiceTripFilter.tripIds.length === 0;

  let trips: TripListRow[];
  let totalTrips: number;

  if (skipTripsQuery) {
    trips = [];
    totalTrips = 0;
  } else {
    /** Liste: no invoice_line_items embed — Rechnungsstatus badges load in a second client query (see docs/trips-performance.md). Kanban keeps the embed until that view is migrated. */
    const tripsListSelect = `
    *,
    payer:payers(name, reha_schein_enabled),
    billing_variant:billing_variants(name, code, billing_types(name, color)),
    driver:accounts!trips_driver_id_fkey(name),
    fremdfirma:fremdfirmen(id, name, default_payment_mode)
  `;

    const tripsKanbanSelect = `
    *,
    payer:payers(name, reha_schein_enabled),
    billing_variant:billing_variants(name, code, billing_types(name, color)),
    driver:accounts!trips_driver_id_fkey(name),
    fremdfirma:fremdfirmen(id, name, default_payment_mode),
    invoice_line_items!invoice_line_items_trip_id_fkey(
      invoice_id,
      invoices(status, paid_at, sent_at)
    )
  `;

    let query = supabase
      .from('trips')
      .select(view === 'kanban' ? tripsKanbanSelect : tripsListSelect, {
        count: 'exact'
      });

    // Apply filters
    if (status) {
      if (status.includes(',')) {
        query = query.in('status', status.split(','));
      } else {
        query = query.eq('status', status);
      }
    }
    if (driverId && driverId !== 'all') {
      if (driverId === 'unassigned') {
        query = query.is('driver_id', null);
      } else {
        query = query.eq('driver_id', driverId);
      }
    }
    if (payerId && payerId !== 'all') {
      query = query.eq('payer_id', payerId);
    }
    if (billingVariantId && billingVariantId !== 'all') {
      query = query.eq('billing_variant_id', billingVariantId);
    }
    // KTS filter — narrows trips by KTS document state.
    // 'kts_fehler' implies kts_document_applies so both conditions are applied.
    // 'all' (default) applies no condition.
    if (ktsFilter === 'kts') {
      query = query.eq('kts_document_applies', true);
    } else if (ktsFilter === 'kts_fehler') {
      query = query.eq('kts_document_applies', true).eq('kts_fehler', true);
    }
    if (
      invoiceTripFilter?.kind === 'in' &&
      invoiceTripFilter.tripIds.length > 0
    ) {
      query = query.in('id', invoiceTripFilter.tripIds);
    }
    if (
      invoiceTripFilter?.kind === 'not_in' &&
      invoiceTripFilter.tripIds.length > 0
    ) {
      query = query.not('id', 'in', `(${invoiceTripFilter.tripIds.join(',')})`);
    }
    if (search) {
      const term = search.replace(/'/g, "''");
      query = query.or(
        `client_name.ilike.%${term}%,pickup_address.ilike.%${term}%,dropoff_address.ilike.%${term}%`
      );
    }
    /**
     * --- Date filter (`scheduled_at` URL param) ---
     *
     * We need BOTH:
     * - Trips with a real time (`scheduled_at` in the user’s selected day or range).
     * - Trips without a time yet (`scheduled_at` NULL) that still “belong” to that day.
     *
     * Anti-pattern (old behaviour): OR-ing plain `scheduled_at.is.null` matched EVERY
     * unscheduled trip in the DB on EVERY date → Kanban looked like old cards were
     * “stuck” when changing the calendar. See `docs/trips-date-filter.md`.
     *
     * Current pattern: unscheduled rows must also match `requested_date` (or the
     * narrow “fully undated backlog” branch for server-“today” only).
     */
    if (scheduledAt) {
      const parts = scheduledAt.split(',');

      if (parts.length === 2) {
        const [from, to] = parts;
        if (from && to) {
          const fromMs = Number(from);
          const toMs = Number(to);
          if (!Number.isNaN(fromMs) && !Number.isNaN(toMs)) {
            const fromYmd = instantToYmdInBusinessTz(fromMs);
            const toYmd = instantToYmdInBusinessTz(toMs);
            const { startISO } = getZonedDayBoundsIso(fromYmd);
            const { endExclusiveISO } = getZonedDayBoundsIso(toYmd);
            query = query.or(
              [
                `and(scheduled_at.gte.${startISO},scheduled_at.lt.${endExclusiveISO})`,
                `and(scheduled_at.is.null,requested_date.gte.${fromYmd},requested_date.lte.${toYmd})`
              ].join(',')
            );
          }
        } else if (from) {
          const fromMs = Number(from);
          if (!Number.isNaN(fromMs)) {
            const fromYmd = instantToYmdInBusinessTz(fromMs);
            const { startISO } = getZonedDayBoundsIso(fromYmd);
            query = query.or(
              [
                `scheduled_at.gte.${startISO}`,
                `and(scheduled_at.is.null,requested_date.gte.${fromYmd})`
              ].join(',')
            );
          }
        } else if (to) {
          const toMs = Number(to);
          if (!Number.isNaN(toMs)) {
            const toYmd = instantToYmdInBusinessTz(toMs);
            const { endExclusiveISO } = getZonedDayBoundsIso(toYmd);
            query = query.or(
              [
                `scheduled_at.lt.${endExclusiveISO}`,
                `and(scheduled_at.is.null,requested_date.lte.${toYmd})`
              ].join(',')
            );
          }
        }
      } else if (parts.length === 1 && parts[0]) {
        const raw = parts[0].trim();
        let dayStr: string | null = null;

        if (isYmdString(raw)) {
          dayStr = raw;
        } else {
          const timestamp = Number(raw);
          if (!Number.isNaN(timestamp)) {
            dayStr = instantToYmdInBusinessTz(timestamp);
          }
        }

        if (dayStr) {
          const { startISO, endExclusiveISO } = getZonedDayBoundsIso(dayStr);
          const branches = [
            `and(scheduled_at.gte.${startISO},scheduled_at.lt.${endExclusiveISO})`,
            `and(scheduled_at.is.null,requested_date.eq.${dayStr})`
          ];
          if (todayYmdInBusinessTz() === dayStr) {
            branches.push(`and(scheduled_at.is.null,requested_date.is.null)`);
          }
          query = query.or(branches.join(','));
        }
      }
    }

    // Parse sorting — whitelist matches client (`TripsTable` + `TRIPS_SORTABLE_IDS`).
    const sorting =
      getSortingStateParser(TRIPS_SORTABLE_IDS).parseServerSide(
        searchParamsCache.get('sort') ?? undefined
      ) || [];

    if (sorting.length > 0) {
      for (const sortRule of sorting) {
        // Never forward unmapped ids to PostgREST (stale or crafted URLs) — skip quietly.
        const mapping = TRIPS_SORT_MAP[sortRule.id as string];
        if (!mapping) continue;
        const opts: { ascending: boolean; foreignTable?: string } = {
          ascending: !sortRule.desc
        };
        if (mapping.foreignTable) {
          opts.foreignTable = mapping.foreignTable;
        }
        query = query.order(mapping.column, opts);
      }
    } else {
      // Default sorting: earliest trips first (chronological)
      query = query.order('scheduled_at', { ascending: true });
    }

    if (view === 'kanban') {
      query = query.limit(2000);
    } else if (page && pageLimit) {
      const from = (page - 1) * pageLimit;
      const to = from + pageLimit - 1;
      query = query.range(from, to);
    }

    const { data, count, error } = await query;
    if (error) throw toQueryError(error);

    trips = (data ?? []) as unknown as TripListRow[];
    totalTrips = count || 0;
  }

  /**
   * Forces `TripsKanbanBoard` to remount when any query-driving param changes so
   * client state (DnD, zoom, etc.) does not pair with a stale `trips` prop if the
   * RSC payload lags behind the URL after `router.replace` / `router.refresh`.
   */
  const kanbanKey = [
    view,
    scheduledAt ?? '',
    driverId ?? '',
    payerId ?? '',
    status ?? '',
    search ?? '',
    billingVariantId ?? '',
    invoiceStatus ?? ''
  ].join('|');

  return (
    <div className='flex min-h-0 min-w-0 flex-1 flex-col space-y-4 overflow-hidden'>
      {/*
        Stack toggle + filters on narrow viewports; row from md up. Parent uses
        PageContainer scrollable={false} with overflow-hidden — keep min-w-0 so
        the filters bar can shrink without clipping horizontally.
      */}
      <div className='flex min-w-0 shrink-0 flex-col gap-3 md:flex-row md:items-start md:gap-3'>
        <TripsViewToggle currentView={view} />
        {/*
          `flex-1` on mobile in a column flex + auto-height parent collapses this block to
          zero — filters/header area disappear. Use natural height on narrow; grow only from md.
        */}
        <div className='w-full min-w-0 shrink-0 md:min-w-0 md:flex-1'>
          <TripsFiltersBar totalItems={totalTrips} />
        </div>
      </div>
      {view === 'kanban' && (
        <TripsKanbanBoard
          key={kanbanKey}
          trips={trips}
          totalItems={totalTrips}
        />
      )}
      {view !== 'kanban' && (
        <TripsTable
          data={trips}
          totalItems={totalTrips}
          columns={columns}
          invoiceStatusTripIds={trips.map((t) => t.id)}
        />
      )}
    </div>
  );
}
