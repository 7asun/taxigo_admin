/**
 * Single source of truth for Fahrten list (`/dashboard/trips`) server-side `ORDER BY`.
 *
 * A generic `.order(urlColumnId)` was unsafe: TanStack `id`s for embed- or
 * badge-derived fields (e.g. Rechnungsstatus) are not `public.trips` column names, so
 * PostgREST returned 4xx and the RSC threw. This map is the only place that translates
 * user-facing sort `id`s to real `.order({ column, foreignTable? })` arguments.
 *
 * Omitted keys (e.g. `invoice_status`, `fremdfirma*`) are not scalar trips columns
 * (or need a view/RPC); those columns set `enableSorting: false` in the table.
 */

export type TripsSortMapping = {
  column: string;
  /** PostgREST embed alias from the query’s `select()` (e.g. `payer`, `driver`). */
  foreignTable?: string;
};

export const TRIPS_SORT_MAP: Record<string, TripsSortMapping> = {
  // Fahrgast — DB column is `client_name` (id stays `name` for existing URLs)
  name: { column: 'client_name' },
  scheduled_at: { column: 'scheduled_at' },
  time: { column: 'scheduled_at' },
  /** Legacy bookmark support — same as Datum/Zeit. */
  date: { column: 'scheduled_at' },
  pickup_address: { column: 'pickup_address' },
  dropoff_address: { column: 'dropoff_address' },
  status: { column: 'status' },
  driver_id: { column: 'name', foreignTable: 'driver' },
  driver_name: { column: 'name', foreignTable: 'driver' },
  payer_name: { column: 'name', foreignTable: 'payer' },
  billing_type: { column: 'name', foreignTable: 'billing_variant' },
  billing_calling_station: { column: 'billing_calling_station' },
  billing_betreuer: { column: 'billing_betreuer' },
  kts_document_applies: { column: 'kts_document_applies' },
  gross_price: { column: 'gross_price' },
  net_price: { column: 'net_price' },
  tax_rate: { column: 'tax_rate' }
};

/**
 * Whitelist for `getSortingStateParser` — RSC and client must pass the same set so
 * `?sort=` is parsed identically in both places (see TripsTable + `trips-listing.tsx`).
 */
export const TRIPS_SORTABLE_IDS: Set<string> = new Set(
  Object.keys(TRIPS_SORT_MAP) as string[]
);
