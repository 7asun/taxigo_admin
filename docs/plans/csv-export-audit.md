# CSV Export Audit

## Section A: Column Selector

### A1. Columns Offered By `ColumnSelectorStep`

`ColumnSelectorStep` renders `EXPORT_COLUMNS` from `src/features/trips/components/csv-export/csv-export-constants.ts`.

- `id` — `ID`
- `scheduled_date` — `Datum`
- `scheduled_time` — `Uhrzeit`
- `requested_date` — `Wunschtermin`
- `status` — `Status`
- `is_wheelchair` — `Rollstuhl`
- `return_status` — `Rückfahrstatus`
- `link_type` — `Verknüpfungstyp`
- `canceled_reason_notes` — `Stornierungsgrund`
- `created_at` — `Erstellt am`
- `client_id` — `Fahrgast ID`
- `client_name` — `Fahrgast Name`
- `client_phone` — `Fahrgast Telefon`
- `greeting_style` — `Anrede`
- `pickup_address` — `Abholadresse (vollständig)`
- `pickup_street` — `Abholung Straße`
- `pickup_street_number` — `Abholung Hausnummer`
- `pickup_zip_code` — `Abholung PLZ`
- `pickup_city` — `Abholung Stadt`
- `pickup_station` — `Abholung Station`
- `pickup_lat` — `Abholung Lat`
- `pickup_lng` — `Abholung Lng`
- `dropoff_address` — `Zieladresse (vollständig)`
- `dropoff_street` — `Ziel Straße`
- `dropoff_street_number` — `Ziel Hausnummer`
- `dropoff_zip_code` — `Ziel PLZ`
- `dropoff_city` — `Ziel Stadt`
- `dropoff_station` — `Ziel Station`
- `dropoff_lat` — `Ziel Lat`
- `dropoff_lng` — `Ziel Lng`
- `payer_id` — `Kostenträger ID`
- `payer_name` — `Kostenträger`
- `billing_variant_id` — `Abrechnungsvariante ID`
- `billing_variant_name` — `Abrechnungsvariante`
- `billing_family_name` — `Abrechnungsfamilie`
- `billing_calling_station` — `Anrufstation`
- `billing_betreuer` — `Betreuer`
- `kts_document_applies` — `KTS (Krankentransportschein)`
- `net_price` — `Preis (Netto)`
- `driver_id` — `Fahrer ID`
- `driver_name` — `Fahrer`
- `vehicle_id` — `Fahrzeug ID`
- `group_id` — `Gruppen ID`
- `stop_order` — `Stop Reihenfolge`
- `notes` — `Notizen`
- `driving_distance_km` — `Fahrtstrecke (km)`
- `driving_duration_seconds` — `Fahrtdauer (Sek)`
- `actual_pickup_at` — `Tatsächliche Abholung`
- `actual_dropoff_at` — `Tatsächliche Ankunft`
- `company_id` — `Unternehmen ID`
- `ingestion_source` — `Importquelle`
- `rule_id` — `Regel ID`
- `linked_trip_id` — `Verknüpfte Fahrt ID`
- `has_missing_geodata` — `Fehlende Geodaten`
- `needs_driver_assignment` — `Fahrerzuordnung nötig`

Columns present in `Database['public']['Tables']['trips']['Row']` but not offered directly:

- `billing_type_id`
- `kts_fehler`
- `kts_fehler_beschreibung`
- `kts_handover_id`
- `kts_patient_id`
- `kts_belegnummer`
- `kts_invoice_amount`
- `kts_eigenanteil`
- `kts_external_invoice_id`
- `kts_source`
- `kts_status`
- `reha_schein`
- `fremdfirma_cost`
- `fremdfirma_id`
- `fremdfirma_payment_mode`
- `no_invoice_required`
- `no_invoice_source`
- `selbstzahler_collected_amount`
- `created_by`
- `dropoff_location`
- `dropoff_place_id`
- `note`
- `payment_method`
- `pickup_location`
- `pickup_place_id`
- `gross_price`
- `tax_rate`
- `base_net_price`
- `approach_fee_net`
- `manual_distance_km`
- `manual_gross_price`
- `manual_tax_rate`
- `scheduled_at` (represented only by derived `scheduled_date` / `scheduled_time`)
- `stop_updates`

Selector keys that are not direct `trips` table columns:

- `scheduled_date` — derived from `trips.scheduled_at`
- `scheduled_time` — derived from `trips.scheduled_at`
- `payer_name` — joined from `payers.name`
- `billing_variant_name` — joined from `billing_variants.name`
- `billing_family_name` — joined from `billing_types.name`
- `driver_name` — joined from `accounts.name`

Important freshness issue: the UI selector and the export API do not share the same column registry. The UI offers `net_price`, but `src/app/api/trips/export/route.ts` does not define an export accessor for `net_price`. The API route defines `price` instead, but `price` is not a `trips` DB column and is not offered by the selector. The API route also defines `note`, `created_by`, and `estimated_duration_min`, which the selector does not offer.

### A2. Source Of Truth

The UI source of truth is hardcoded in `src/features/trips/components/csv-export/csv-export-constants.ts`.

`ColumnSelectorStep` only groups and renders that constant. `csv-export.types.ts` defines the `ExportColumn` interface and wizard request types, but it does not define the available columns. The export API route has a second, separate hardcoded `EXPORT_COLUMNS` array with server-side accessors. There is no dynamic resolution from Supabase types or runtime schema.

### A3. Does `/api/trips/export` Select Only Requested Columns?

No. The export API fetches all trip columns plus joins, then filters/serializes the selected columns in application code.

Relevant query:

```ts
let query = admin
  .from('trips')
  .select(
    `
    *,
    payer:payers!trips_payer_id_fkey(name),
    billing_variant:billing_variants!trips_billing_variant_id_fkey(name, billing_types!billing_variants_billing_type_id_fkey(name)),
    driver:accounts!trips_driver_id_fkey(name)
  `
  )
  .eq('company_id', companyId)
  .or(
    `and(scheduled_at.gte.${fromISO},scheduled_at.lt.${toISO}),and(scheduled_at.is.null,requested_date.gte.${dateFrom},requested_date.lte.${dateTo})`
  );
```

The requested `columns` array is only applied after the query returns:

```ts
const selectedColumns = EXPORT_COLUMNS.filter((col) =>
  columns.includes(col.key)
);

const csvRows = trips.map((trip) => {
  const row: Record<string, unknown> = {};
  selectedColumns.forEach((col) => {
    row[col.label] = col.accessor(trip as Record<string, unknown>);
  });
  return row;
});
```

## Section B: Current Filters

### B4. Export Preview And Export Route Filters

`GET /api/trips/export/preview` accepts these query parameters:

- `payer_id`: optional. Maps to `.eq('payer_id', payerId)` on both sample and count queries.
- `billing_variant_id`: optional. Maps to `.eq('billing_variant_id', billingVariantId)` on both sample and count queries.
- `date_from`: required. Used to build the lower business-date bound.
- `date_to`: required. Used to build the upper business-date bound.

Both preview queries always add:

- Auth-scoped company filter: `.eq('company_id', companyId)`
- Date filter:
  - `scheduled_at >= fromISO AND scheduled_at < toISO`
  - OR `scheduled_at IS NULL AND requested_date >= date_from AND requested_date <= date_to`

`POST /api/trips/export` accepts this JSON body:

- `payerId`: optional nullable UUID. Maps to `.eq('payer_id', payerId)`.
- `billingTypeId`: optional nullable UUID. Despite the name, this maps to `.eq('billing_variant_id', billingTypeId)`.
- `dateFrom`: required `YYYY-MM-DD`. Used to build the lower business-date bound.
- `dateTo`: required `YYYY-MM-DD`. Used to build the upper business-date bound.
- `columns`: required non-empty string array. Used only after fetching to select server-side export accessors.
- `includeHeaders`: optional boolean. Accepted by the schema but effectively ignored because `papaparse.unparse({ fields, data })` always receives `fields`.

The POST route always adds:

- Auth-scoped company filter: `.eq('company_id', companyId)`
- Date filter:
  - `scheduled_at >= fromISO AND scheduled_at < toISO`
  - OR `scheduled_at IS NULL AND requested_date >= dateFrom AND requested_date <= dateTo`
- Sort: `.order('scheduled_at', { ascending: true })`

### B5. Trips List View Filter Dimensions

The main trips list view uses URL search params as the source of truth. `TripsFiltersBar` reads/writes `useSearchParams()` and `trips-listing.tsx` reads the same keys through `searchParamsCache` in `src/lib/searchparams.ts`.

Supported list filters:

- `search`: local input state is debounced, then written to URL. Server maps it to `.or(client_name.ilike, pickup_address.ilike, dropoff_address.ilike)`.
- `scheduled_at`: URL param. Client date picker writes either a single date/timestamp or `from,to`. Server maps it to business-date `scheduled_at` bounds plus scoped `requested_date` fallback for unscheduled trips.
- `driver_id`: overloaded URL param. Server parses it with `parseAssigneeParam`.
  - absent / `all`: no assignee filter.
  - `unassigned`: `.is('driver_id', null).is('fremdfirma_id', null)`.
  - `fremdfirma:all`: `.not('fremdfirma_id', 'is', null)`.
  - `fremdfirma:<id>`: `.eq('fremdfirma_id', id)`.
  - any other value: `.eq('driver_id', id)`.
- `status`: URL param. UI offers `pending`, `assigned`, `in_progress`, `completed`, `cancelled`; server also supports comma-separated values via `.in('status', status.split(','))`.
- `payer_id`: comma-separated URL param parsed as string array. Server maps to `.in('payer_id', payerIds)`.
- `billing_variant_id`: comma-separated URL param parsed as string array. Server maps to `.in('billing_variant_id', billingVariantIds)`.
- `invoice_status`: URL param. UI offers `uninvoiced`, `draft`, `sent`, `paid`. Server resolves matching trip IDs via RPC `trip_ids_matching_invoice_effective_status`, then applies `.in('id', tripIds)` or `.not('id', 'in', ...)`.
- `kts_filter`: comma-separated URL param. Shared parser supports `kts`, `kts_fehler`, `no_kts`, `no_reha`, `reha`.
  - `kts`: `.eq('kts_document_applies', true)`.
  - `kts_fehler`: `.eq('kts_document_applies', true).eq('kts_fehler', true)`.
  - `no_kts`: `.eq('kts_document_applies', false)`.
  - `reha`: `.eq('reha_schein', true)`.
  - `no_reha`: `.eq('reha_schein', false)`.
  - Multiple selections become a controlled OR plan, except the exact `no_kts + no_reha` pair is an AND.
- `sort`: URL param. Parsed through `getSortingStateParser(TRIPS_SORTABLE_IDS)` and mapped through `TRIPS_SORT_MAP`.
- `page` / `perPage`: URL params. Server maps them to `.range(from, to)` for list view pagination.
- `view`: URL param. Chooses list vs kanban and changes the select shape/limit.

Related state that is not a row filter:

- Column visibility and column order live in the Zustand store `useTripsTableStore`.
- Saved views/presets store a whitelist of URL params in `trip_presets.params`, plus column visibility/order JSON.

## Section C: Data Model

### C6. Driver Linkage

`trips` has a direct nullable `driver_id: string | null` column.

There is no `drivers` table in `src/types/database.types.ts`. Drivers are represented by `accounts` rows with `role = 'driver'` and `is_active = true`. `driver_profiles` is a separate profile/details table linked to `accounts`, but trip assignment uses `trips.driver_id -> accounts.id`.

The list/export join for display names is:

```ts
driver:accounts!trips_driver_id_fkey(name)
```

### C7. Fremdfirma Model

Fremdfirma is not a boolean on `trips`. It is a separate table, `fremdfirmen`, and trips link to it through:

- `trips.fremdfirma_id: string | null`
- FK `trips_fremdfirma_id_fkey` references `fremdfirmen.id`

Related trip columns:

- `fremdfirma_payment_mode: string | null`
- `fremdfirma_cost: number | null`

The shared join fragment is:

```ts
fremdfirma:fremdfirmen(id, name, default_payment_mode)
```

### C8. Useful Export Filter Columns And Types

There is no direct `trip_type` column and no direct `is_return_trip` column. Return/outbound semantics are represented by `link_type`, `linked_trip_id`, and `return_status`.

Useful direct `trips` filter candidates:

- `status: string`
- `scheduled_at: string | null`
- `requested_date: string | null`
- `driver_id: string | null`
- `fremdfirma_id: string | null`
- `vehicle_id: string | null`
- `payer_id: string | null`
- `billing_type_id: string | null`
- `billing_variant_id: string | null`
- `client_id: string | null`
- `kts_document_applies: boolean`
- `kts_fehler: boolean`
- `kts_status: 'ungeprueft' | 'korrekt' | 'fehlerhaft' | 'in_korrektur' | 'uebergeben' | 'abgerechnet' | null`
- `reha_schein: boolean`
- `no_invoice_required: boolean`
- `needs_driver_assignment: boolean`
- `is_wheelchair: boolean`
- `has_missing_geodata: boolean`
- `link_type: string | null`
- `linked_trip_id: string | null`
- `return_status: string | null`
- `rule_id: string | null`
- `payment_method: string | null`
- `ingestion_source: string | null`
- `pickup_city: string | null`
- `dropoff_city: string | null`
- `pickup_station: string | null`
- `dropoff_station: string | null`
- `gross_price: number | null`
- `net_price: number`
- `tax_rate: number | null`
- `manual_distance_km: number | null`
- `manual_gross_price: number | null`

Useful joined filter/display candidates:

- `accounts.name` for driver labels.
- `fremdfirmen.name` for Fremdfirma labels.
- `payers.name` and payer capability flags such as `reha_schein_enabled`.
- `billing_variants.name`, `billing_variants.code`, and parent `billing_types.name`.
- Effective invoice status, currently resolved via RPC rather than a direct `trips` column.

### C9. “Only Trips With A KTS Value”

In the current list view, “Nur KTS” means:

```ts
trips.kts_document_applies = true
```

It is not a billing variant name match and not a joined table condition. The KTS default can come from payer/billing variant configuration during creation, but the persisted per-trip value is `trips.kts_document_applies`.

For more granular KTS filters, the DB also has:

- `kts_fehler`
- `kts_fehler_beschreibung`
- `kts_patient_id`
- `kts_belegnummer`
- `kts_invoice_amount`
- `kts_eigenanteil`
- `kts_external_invoice_id`
- `kts_source`
- `kts_status`
- `kts_handover_id`

## Section D: Architecture Fit

### D10. Is `useTripFormData` The Right Hook To Extend?

`useTripFormData` already fetches:

- Payers through `usePayersQuery`.
- Active driver accounts through `useDriversQuery`.
- Billing variants for a selected payer through `useBillingVariantsForPayerQuery`.
- Client search helpers via direct Supabase client queries.

It does not fetch Fremdfirmen. The trips filter bar currently imports `useFremdfirmenQuery` separately from `use-trip-reference-queries.ts`.

Best fit: do not keep extending `useTripFormData` for every export-only filter. The cleaner layer is the existing reference query layer in `use-trip-reference-queries.ts` / `trip-reference-data.ts`. A small export-specific hook could compose `useTripFormData(singlePayerId)` plus `useFremdfirmenQuery()` if the wizard needs a convenient bundle, but the primitive data-fetching functions should stay reusable and query-keyed there.

### D11. Does The Export Wizard Share State With The Trips List?

Currently it is isolated.

`DownloadCsvButton` owns only `dialogOpen` and renders:

```tsx
<CsvExportDialog open={dialogOpen} onOpenChange={setDialogOpen} />
```

`CsvExportDialog` resets its own local state on open:

- `payerId`
- `billingTypeId`
- `dateFrom`
- `dateTo`
- `selectedColumns`
- preview/export state

There is no context, prop, Zustand link, or URL reader in the dialog today.

However, the list view already exposes a practical prefill mechanism: URL params are the source of truth for the list filters. The dialog could read `useSearchParams()` on open and translate `payer_id`, `billing_variant_id`, `scheduled_at`, `driver_id`, `status`, `invoice_status`, and `kts_filter` into its own draft filter state. This would not require coupling to table internals.

## Section E: Senior Recommendation

Add flexible export filters by sharing the list view’s filter vocabulary, not by inventing a generic DB-column filter builder.

Recommended shape:

- Create a small typed export filter contract that mirrors the meaningful URL filters: date range, assignee (`driver` / `unassigned` / `fremdfirma`), status, payer IDs, billing variant IDs, KTS/Reha tokens, and optionally invoice status.
- Extract the server-side query translation into a shared helper used by both `export/preview` and `export`. Keep it explicit, similar to `trips-listing.tsx`, so complex cases like KTS `no_kts + no_reha` and Fremdfirma assignment remain readable.
- Keep the wizard user-facing, not database-facing. Add a dedicated “Filter” step or turn the current payer/billing step into “Export-Filter” with compact sections. Once driver, Fremdfirma, status, KTS, and invoice status are included, a dedicated filter step is cleaner than overloading the payer/billing step.
- Support “use current list filters” as the default when opening from the Fahrten page by reading URL params. Let users adjust the export filters in the wizard before preview/download.
- Unify column definitions into one shared pure TypeScript registry used by the selector, preview labels, and export API accessors. At minimum, fix the current `net_price` vs `price` drift and add the important missing DB columns (`reha_schein`, Fremdfirma fields, KTS detail/status fields, invoice/no-invoice fields, gross/tax/manual price fields).
- Do not optimize SELECT projection first unless exports are large enough to justify it. The higher-risk bug is stale/duplicated column metadata. First centralize the whitelist and accessors; then, if needed, derive the Supabase select string from that registry.

The lowest-risk implementation path is: shared column registry, shared export filter schema/query applier for preview and download, and a dedicated filter step that can initialize from the current URL filters.

## Plan Executed (2026-06-19)

Implemented per `.cursor/plans/csv_export_refactor_0a510f35.plan.md`:

- Added `export-columns.registry.ts` with shared `EXPORT_COLUMN_DEFS` and `net_price` accessor (removed stale `price` key from API)
- Added `export-query.ts` with `applyExportFilters`, Zod `{ filters, columns, includeHeaders }` schema, and preview param parse/serialize
- Updated `/api/trips/export` and `/api/trips/export/preview` atomically; preview flattens sample rows through registry accessors
- Added `fetchAllBillingVariants` + `useBillingVariantsQuery` for export filter when zero/multiple payers selected
- Replaced payer/billing step with `ExportFilterStep` (assignee, status, KTS multi-select); dialog uses `ExportFilters` + `useExportFilterPrefill`
- Created `docs/features/csv-export.md`

**Deviations:** none — deferred items (invoice filter, SELECT projection, extra DB columns) intentionally not included.
