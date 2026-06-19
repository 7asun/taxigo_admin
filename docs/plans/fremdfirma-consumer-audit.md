# Fremdfirma Consumer Surface Audit

## Scope Notes

The requested `src/app/(dashboard)/fahrten/page.tsx` and
`src/app/(dashboard)/fahrten/components/` paths do not exist in this repository.
The actual Fahrten route is:

- `src/app/dashboard/trips/page.tsx`
- `src/app/dashboard/trips/fahrten-page-shell.tsx`
- `src/app/dashboard/trips/trips-header-actions.tsx`

The requested `src/features/trips/components/trips-table/` directory also does
not exist. The actual table directory is
`src/features/trips/components/trips-tables/`.

The requested `src/features/unassigned-trips/components/pending-tours-widget.tsx`
and `src/features/unassigned-trips/hooks/` paths do not exist. The pending tours
widget lives in `src/features/dashboard/components/pending-tours-widget.tsx` and
uses `src/features/dashboard/hooks/use-unplanned-trips.ts`.

Findings below are based on the actual files present in the repo, plus a
codebase search for `driver_id` and `fremdfirma_id` outside trip detail/form
surfaces.

## 1. Trips Table (`/dashboard/trips`)

The route `src/app/dashboard/trips/page.tsx` renders
`TripsListingPage` from `src/features/trips/components/trips-listing.tsx`.
`TripsListingPage` selects rows and passes them to either `TripsTable` or
`TripsKanbanBoard`.

### Rendered Columns

The desktop table columns are defined in
`src/features/trips/components/trips-tables/columns.tsx`.

- Selection checkbox: table row selection only.
- `Datum`: reads `scheduled_at`.
- `Zeit`: reads `scheduled_at`, `status`, and `rule_id` for urgency/recurring icon.
- `Fahrgast`: reads passenger display fields through `resolvePassengerLabel(row.original)` and `is_wheelchair`.
- `Abholung`: reads pickup address fields through `parseTripAddressForDataTable(row.original, 'pickup')` and `pickup_station`.
- `Ziel`: reads dropoff address fields through `parseTripAddressForDataTable(row.original, 'dropoff')` and `dropoff_station`.
- `Fahrer`: column id `driver_id`, accessor key `driver.name`, renders `DriverSelectCell` with the full trip row.
- `Status`: reads `status`.
- `Brutto`: reads `gross_price`.
- `Rechnungsstatus`: reads `id` and resolves status through `TripInvoiceStatusBadgeCell`.
- `Kostenträger`: reads `payer.name`.
- `Fremdfirma`: reads `fremdfirma.name`.
- `Abrechnung Fremdfirma`: reads `fremdfirma_id` and `fremdfirma_payment_mode`.
- `Abrechnung`: reads `billing_variant` and nested `billing_types`.
- `Anrufstation`: reads `billing_calling_station`.
- `Betreuer`: reads `billing_betreuer`.
- `KTS`: reads `kts_document_applies`, `kts_fehler`, and `reha_schein` via inline cell state and the conflict indicator.
- `KTS-Fehler`: reads `kts_fehler`.
- `KTS-Fehler (Text)`: reads `kts_fehler_beschreibung`.
- `Reha`: reads `reha_schein` and `payer.reha_schein_enabled`; hidden by default.
- `Netto`: reads `net_price`; hidden by default.
- `MwSt.`: reads `tax_rate`; hidden by default.
- Actions: renders row actions with full trip row.

The mobile list is separate:
`src/features/trips/components/trips-tables/trips-mobile-card-list.tsx`. It
renders time/date, passenger, status, KTS badge, route, wheelchair, and actions.
It does not render driver, Fremdfirma, or assignee state.

### Assignee Display

The desktop table currently displays both driver and Fremdfirma information:

- `Fahrer` column uses `DriverSelectCell`.
- `Fremdfirma` column displays `row.original.fremdfirma?.name`.
- `Abrechnung Fremdfirma` displays the Fremdfirma payment mode if `fremdfirma_id` is set.

In `DriverSelectCell`, Fremdfirma rows are explicitly handled:

```tsx
if (trip.fremdfirma_id) {
  return (
    <span
      className='max-w-[11rem] text-center text-xs leading-tight font-medium'
      title='Abrechnungsart siehe Spalte „Abrechnung Fremdfirma“'
    >
      Extern · {trip.fremdfirma?.name ?? 'Fremdfirma'}
    </span>
  );
}
```

So when `driver_id` is null and `fremdfirma_id` is set, the desktop driver column
does not show blank or an error. It shows `Extern · <Fremdfirma name>` if the
join is present, or `Extern · Fremdfirma` as fallback.

The mobile card list does not show the assignee at all, so a Fremdfirma-assigned
trip has no visible assignee distinction on narrow screens.

### Filters

The filter bar is `src/features/trips/components/trips-filters-bar.tsx`.
Current filters are:

- Search text: `search`; applied to `client_name`, `pickup_address`, `dropoff_address`.
- Date/range: `scheduled_at`.
- Invoice status: `invoice_status`.
- Column visibility: not a data filter.
- Driver: `driver_id`, options `Alle Fahrer`, `Nicht zugewiesen`, and active drivers.
- Status: `status`, options `pending`, `assigned`, `in_progress`, `completed`, `cancelled`.
- KTS/Reha semantic filter: `kts_filter`.
- Kostenträger: `payer_id`, multi-select.
- Abrechnung: `billing_variant_id`, multi-select when exactly one payer is selected.

There is no filter that touches `fremdfirma_id`.

The driver filter uses `driver_id=unassigned` as a URL sentinel and the server
query translates it to `driver_id IS NULL`. That means the table's "Nicht
zugewiesen" driver filter includes Fremdfirma-assigned trips unless another
filter excludes them.

### Supabase Query

The table query lives in `src/features/trips/components/trips-listing.tsx`.
It has separate select strings for list and Kanban. Both already join
`fremdfirma:fremdfirmen(id, name, default_payment_mode)`.

Exact list select:

```ts
const tripsListSelect = `
    *,
    payer:payers(name, reha_schein_enabled),
    billing_variant:billing_variants(name, code, billing_types(name, color)),
    driver:accounts!trips_driver_id_fkey(name),
    fremdfirma:fremdfirmen(id, name, default_payment_mode)
  `;
```

Exact Kanban select:

```ts
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
```

Relevant filter logic:

```ts
if (driverId && driverId !== 'all') {
  if (driverId === 'unassigned') {
    query = query.is('driver_id', null);
  } else {
    query = query.eq('driver_id', driverId);
  }
}
```

The query layer understands the Fremdfirma join for display, but the URL filters
still understand only internal driver assignment.

## 2. `pending-tours-widget.tsx`

The widget is `src/features/dashboard/components/pending-tours-widget.tsx`. Its
data hook is `src/features/dashboard/hooks/use-unplanned-trips.ts`.

### Exact Query

Primary query:

```ts
const { data: unplannedRows, error: fetchError } = await supabase
  .from('trips')
  .select('*, requested_date')
  .or('scheduled_at.is.null,driver_id.is.null')
  .not('status', 'in', '("cancelled","completed")')
  .order('created_at', { ascending: false });
```

Linked partner enrichment query:

```ts
const { data: linkedRows } = await supabase
  .from('trips')
  .select('id, scheduled_at, status, link_type')
  .in('id', linkedIds);
```

The widget also fetches internal drivers independently:

```ts
const { data } = await supabase
  .from('accounts')
  .select('id, name')
  .eq('role', 'driver')
  .order('name');
```

### Count and Display Behavior

The hook returns trips with no scheduled time or no internal driver. The widget
description then counts:

```ts
const noTime = trips.filter((t) => !t.scheduled_at).length;
const noDriver = trips.filter(
  (t) => t.scheduled_at && !t.driver_id
).length;
```

This is not total pending trips by status. It is "unplanned" operational work:
missing time and/or missing internal driver.

Because Fremdfirma assignment currently means `driver_id = null` and
`fremdfirma_id = set`, a scheduled Fremdfirma trip is included by the query and
counted as `ohne Fahrer`.

The row UI initializes the driver select from `trip.driver_id ?? null` and shows
only internal driver choices plus `Ohne Fahrer`. It does not show any
Fremdfirma badge or label. A Fremdfirma trip therefore appears as a normal
"Offene Tour" row with the driver select on `Ohne Fahrer`.

The save path does pass `fremdfirmaId` to status derivation:

```ts
const derivedStatus = getStatusWhenDriverChanges(trip.status, driverId, {
  fremdfirmaId: trip.fremdfirma_id
});
```

That protects status derivation, but it does not prevent the widget from
including or visually mixing Fremdfirma trips in the "without driver" queue.

There is no separate count, badge, row style, or filter for Fremdfirma trips.

## 3. Other Consumer Surfaces

### `/dashboard/trips` Route Shell

`src/app/dashboard/trips/page.tsx` only wires the route. It does not inspect
`driver_id` or `fremdfirma_id`. It renders `TripsListingPage`.

`src/app/dashboard/trips/trips-header-actions.tsx` exposes print, CSV export,
bulk upload, and saved views. It does not directly inspect trip assignment.

### Trips Listing, Filters, and Desktop Table

`src/features/trips/components/trips-listing.tsx` uses `driver_id` for server
filtering and joins both driver and Fremdfirma for list/Kanban rows. It handles
Fremdfirma for display data availability but not for filters. The
`driver_id IS NULL` branch mixes true unassigned trips and Fremdfirma-assigned
trips.

`src/features/trips/components/trips-filters-bar.tsx` reads and writes the
`driver_id` URL param. It has no `fremdfirma_id` param, no Fremdfirma option
group, and reset logic clears only `driver_id`.

`src/features/trips/components/trips-tables/columns.tsx` displays Fremdfirma
name and payment mode in dedicated columns. It does not define a Fremdfirma
filter. It also keeps the primary assignee control labeled `Fahrer`, even though
Fremdfirma rows render external assignment in that column.

`src/features/trips/components/trips-tables/driver-select-cell.tsx` is the most
complete consumer. It branches on `trip.fremdfirma_id`, renders
`Extern · <name>`, disables the internal-driver select, and passes
`fremdfirmaId` to `getStatusWhenDriverChanges()` when driver changes happen.

`src/features/trips/components/trips-tables/trips-mobile-card-list.tsx` does
not read `driver_id` or `fremdfirma_id` and does not display assignee state. It
therefore loses the desktop Fremdfirma distinction on mobile.

### Kanban

`src/features/trips/lib/kanban-columns.ts` groups driver mode by
`trip.driver_id ?? 'unassigned'`. It does not branch on `fremdfirma_id`, so
Fremdfirma-assigned trips appear in the `Nicht zugewiesen` column when grouped
by driver.

`src/features/trips/components/kanban/kanban-board.tsx` stages drag/drop
assignment by writing `pendingChanges[id].driver_id`. On save it correctly
passes `trip?.fremdfirma_id` into `getStatusWhenDriverChanges()`. However, the
immediate staged badge helper in `src/features/trips/lib/kanban-grouping.ts`
does not pass `fremdfirmaId`:

```ts
return (
  getStatusWhenDriverChanges(currentStatus, newDriverId) ?? currentStatus
);
```

So Kanban has two different levels of awareness:

- Final save status derivation is Fremdfirma-aware.
- Driver-column grouping and immediate staged status derivation are not.

`src/features/trips/components/kanban/kanban-trip-card.tsx` renders time,
passenger, status, payer, billing, wheelchair, grouping, and route. It does not
render driver or Fremdfirma identity inside the card; the column supplies that
context only when grouping by driver.

### Print ZIP

`src/features/trips/components/print-trips-button.tsx` selects driver but not
Fremdfirma:

```ts
const tripsQuery = supabase
  .from('trips')
  .select(
    `
          *,
          driver:accounts!trips_driver_id_fkey(name),
          billing_variant:billing_variants(*, billing_types(name, color))
        `
  )
  .gte('scheduled_at', start)
  .lte('scheduled_at', end)
  .neq('status', 'cancelled')
  .order('scheduled_at', { ascending: true });
```

It groups PDF generation by internal driver name:

```ts
const driverName = trip.driver?.name || 'Nicht zugewiesen';
```

It also builds overview columns via `buildColumns(..., 'driver', drivers)`,
which uses `driver_id ?? 'unassigned'`. Fremdfirma trips therefore land in
`Nicht zugewiesen` for print grouping and are not labeled as external.

`src/features/trips/components/mobile-print-template.tsx` has `driver_id` and
`driver` in its `TripData` type, but no Fremdfirma fields. It displays the
driver name passed from the grouping key, not a resolved assignee.

`src/features/trips/components/board-landscape-only-print-template.tsx` and the
overview print templates consume already-grouped columns/items. They inherit the
same driver-only grouping.

### CSV Export

`src/app/api/trips/export/route.ts` offers driver columns but no Fremdfirma
columns:

```ts
{ key: 'driver_id', label: 'Fahrer ID', accessor: (t) => t.driver_id ?? '' },
{
  key: 'driver_name',
  label: 'Fahrer',
  accessor: (t) => (t.driver as Record<string, string> | null)?.name ?? ''
}
```

The export query joins driver but not Fremdfirma:

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
```

`src/app/api/trips/export/preview/route.ts` has the same pattern: sample rows
join driver but not Fremdfirma, and the count query counts all matching trips
without assignee-type grouping.

`src/features/trips/components/csv-export/csv-export-constants.ts` exposes
`driver_id`, `driver_name`, and `vehicle_id` in the "Fahrer & Fahrzeug"
category. It exposes no `fremdfirma_id`, `fremdfirma_name`,
`fremdfirma_payment_mode`, or canonical assignee column.

### Dashboard KPI Cards

`src/app/dashboard/overview/layout.tsx` uses `useTrips()` from
`src/features/trips/hooks/use-trips.ts`, which calls `tripsService.getTrips()`.
That service currently runs:

```ts
const { data, error } = await supabase
  .from('trips')
  .select('*')
  .order('scheduled_at', { ascending: false });
```

The KPI cards count "Fahrten heute" and "Umsatz heute" using
`getTripsForDay()` and `calculateTotalRevenue()`. They do not group, filter, or
display by assignment type. Fremdfirma trips are included as normal trips if
they match date/status.

### Dashboard Timeless Rule Trips Widget

`src/features/dashboard/hooks/use-timeless-rule-trips.ts` fetches recurring
rule-generated trips without a scheduled time. The main query selects `*`, so it
receives `driver_id` and `fremdfirma_id`, but its explicit partner query selects
`driver_id` and not `fremdfirma_id`:

```ts
.select(
  `id, scheduled_at, status, link_type, requested_date, rule_id, client_id, client_name, pickup_address, dropoff_address, driver_id, linked_trip_id, payer_id, billing_variant_id, ${TIMELESS_TRIP_EMBEDS}`
)
```

The widget only sets `scheduled_at`. It does not display or filter assignment.
It neither helps nor hurts Fremdfirma display except that partner rows are
driver-only if assignment later becomes relevant there.

### Pending Assignments / Dispatch Inbox

`src/features/trips/components/pending-assignments/use-pending-assignments.ts`
is a driver-assignment inbox. It queries:

```ts
.from('trips')
.select(TRIP_FIELDS)
.is('driver_id', null)
.not('scheduled_at', 'is', null)
.neq('status', 'cancelled')
```

and:

```ts
.from('trips')
.select(TRIP_FIELDS)
.is('driver_id', null)
.is('scheduled_at', null)
.neq('status', 'cancelled')
```

and CSV failed matches:

```ts
.from('trips')
.select(TRIP_FIELDS)
.eq('needs_driver_assignment', true)
.is('driver_id', null)
.neq('status', 'cancelled')
```

`TRIP_FIELDS` does not include `fremdfirma_id` or a Fremdfirma join. Scheduled
Fremdfirma trips can be included in the first two lists because they have
`driver_id = null`. The CSV list is partly protected by
`needs_driver_assignment = true`, but the other lists are not.

`src/features/trips/components/pending-assignments/debug-queries.ts` also uses
`.is('driver_id', null)` and does not account for `fremdfirma_id`.

### Unassigned Billing Variant Surface

`src/features/unassigned-trips/api/unassigned-trips.service.ts` and
`src/app/dashboard/settings/unzugeordnete-fahrten/page.tsx` query trips with
`billing_variant_id IS NULL`. They do not read `driver_id` or `fremdfirma_id`.
This surface is about missing billing assignment, not missing driver assignment.
No Fremdfirma handling is present or needed unless future UI wants to show
assignee context.

### Client Trips Panel

`src/features/trips/components/client-trips-panel.tsx` selects:

```ts
'id, scheduled_at, pickup_address, dropoff_address, status, is_wheelchair, group_id, client_name, rule_id, client_id, billing_variant:billing_variants(name, code, billing_types(name, color)), payer:payers(name), driver:accounts!trips_driver_id_fkey(name)'
```

It does not join Fremdfirma. It renders `TripRow` from the overview feature, so
future display of assignee identity in client-side trip snippets would currently
be driver-only.

### Driver Portal

`src/features/driver-portal/api/driver-trips.service.ts` filters by
`.eq('driver_id', driverId)`. This is intentionally internal-driver-only:
external-company trips should not appear in an individual driver portal unless a
separate external-company portal exists. It does not need Fremdfirma display for
its current purpose.

### Fleet / Live Tracking

`src/lib/tracking/use-fleet-map.ts` reads active trip `driver_id` values:

```ts
supabase
  .from('trips')
  .select('driver_id')
  .eq('company_id', companyId)
  .in('status', [...TRACKING_BUSY_TRIP_STATUSES])
```

It builds a busy-driver set for live fleet markers. This is intentionally
internal-driver-only and should not try to mark Fremdfirma vehicles unless
tracking exists for them.

### Shift Reconciliations

`src/features/shift-reconciliations/api/shift-reconciliations.service.ts`
fetches trips for one internal driver and day:

```ts
.eq('driver_id', driverId)
.eq('status', SHIFT_RECONCILIATION_TRIP_STATUS)
```

This surface is internal-driver revenue reconciliation. Fremdfirma trips should
not be silently included in a driver shift, but the broader domain may need a
separate Fremdfirma cost/reconciliation path.

### Invoice Line Item Builder

`src/features/invoices/api/invoice-line-items.api.ts` selects
`driver:accounts!trips_driver_id_fkey(name)` for normal and cancelled invoice
builder trips. It does not join Fremdfirma. It uses driver name as snapshot
context, not as a filter in the shown code. If invoice PDFs or line details need
the actual assignee, this is currently driver-only.

### Controlling

`src/features/controlling/api/controlling.service.ts` receives
`unassigned_trips`, `fremdfirma_trips`, and `fremdfirma_cost` from
`get_controlling_operational`, so operational flags can show a separate
Fremdfirma count.

`src/features/controlling/components/OperationalFlags.tsx` displays both:

- `Fahrten ohne Fahrer: <unassigned_trips>`
- `Fremdfirma-Fahrten: <fremdfirma_trips> (Kosten: <fremdfirma_cost>)`

Correctness depends on the RPC defining `unassigned_trips` as "no driver and no
Fremdfirma". The frontend does not enforce that distinction.

`src/features/controlling/lib/controlling-utils.ts` aggregates driver breakdown
rows by `row.driver_id ?? '__unassigned__'` and labels null as
`Nicht zugewiesen`. If the breakdown RPC emits Fremdfirma trips with
`driver_id = null`, those rows will be grouped as unassigned in
`DriverRevenueChart` and `DriverTable`.

### Trip Creation, Duplication, and Imports

These are write surfaces rather than consumer display surfaces, but they affect
what downstream consumers see:

- `src/features/trips/lib/duplicate-trips.ts` intentionally clears both
  `driver_id` and `fremdfirma_id` on duplicates.
- `src/features/trips/lib/build-return-trip-insert.ts` intentionally clears
  Fremdfirma fields on manual return-trip creation and uses the selected
  internal driver.
- `src/features/trips/components/bulk-upload-dialog.tsx` writes `driver_id`
  from CSV matching and `needs_driver_assignment`; it has no Fremdfirma import
  support.

These do not directly display assignment, but they reinforce that most
non-detail creation paths are internal-driver-only.

## 4. Existing Join Patterns

Across the consumer files read in this audit, the main Fahrten list/Kanban query
is the only consumer query that already joins `fremdfirmen` onto trips.

Exact list fragment:

```ts
fremdfirma:fremdfirmen(id, name, default_payment_mode)
```

Exact Kanban fragment:

```ts
fremdfirma:fremdfirmen(id, name, default_payment_mode),
```

`tripsService.getTripById()` also joins Fremdfirma, but that is the trip detail
query rather than a broad consumer:

```ts
'*, billing_variant:billing_variants(*, billing_types(name, color, behavior_profile)), clients(*), payers(*), driver:accounts!trips_driver_id_fkey(name), fremdfirma:fremdfirmen(id, name, default_payment_mode)'
```

Other consumer queries generally join only driver:

- CSV export and preview: `driver:accounts!trips_driver_id_fkey(name)`.
- Print export: `driver:accounts!trips_driver_id_fkey(name)`.
- Client trips panel: `driver:accounts!trips_driver_id_fkey(name)`.
- Invoice builder: `driver:accounts!trips_driver_id_fkey(name)`.
- `tripsService.getUpcomingTrips()`: driver join only.

There is no shared trip query builder used across all consumers. The repo has
shared query key factories:

- `tripKeys` in `src/query/keys/trips.ts`
- `referenceKeys` in `src/query/keys/reference.ts`

There are also shared reference-list queries for drivers, payers, billing
variants, and Fremdfirmen:

```ts
export function useFremdfirmenQuery() {
  return useQuery({
    queryKey: referenceKeys.fremdfirmen(),
    queryFn: fetchActiveFremdfirmen,
    staleTime: TRIP_REFERENCE_STALE_TIME_MS
  });
}
```

But trip row selection, joins, filtering, grouping, and export transforms are
defined independently by each consumer.

## 5. Senior Recommendation

### Minimal Shared Abstractions

The minimal set should be small and centered in the trips feature, not spread
through dashboard/export/controlling first.

Recommended location:

- `src/features/trips/lib/trip-assignee.ts`
- optionally `src/features/trips/components/trip-assignee-label.tsx`
- optionally shared row types in `src/features/trips/types/trip-assignee.ts`

Minimum API:

- `TripAssignee` discriminated union:
  - `{ kind: 'driver'; id: string; label: string }`
  - `{ kind: 'fremdfirma'; id: string; label: string; paymentMode?: string | null }`
  - `{ kind: 'unassigned'; label: 'Nicht zugewiesen' }`
- `resolveTripAssignee(trip)` that prefers `fremdfirma_id` when present, otherwise `driver_id`, otherwise unassigned.
- `isTripAssigned(trip)` and `isTripUnassignedForDispatch(trip)` so query/filter consumers do not hand-roll `!driver_id`.
- shared select fragments or at least constants:
  - driver join fragment
  - Fremdfirma join fragment
  - combined assignee join fragment for consumers that display assignment
- filter helpers:
  - parse assignee filter values such as `driver:<uuid>`, `fremdfirma:<uuid>`, `unassigned`
  - apply the corresponding Supabase filters
  - define unassigned as `driver_id IS NULL AND fremdfirma_id IS NULL`

The first practical integration should update these consumers in this order:

1. `trips-listing.tsx` and `trips-filters-bar.tsx`: make filtering semantic so
   `Nicht zugewiesen` stops including Fremdfirma trips and add a Fremdfirma
   assignee option.
2. `DriverSelectCell`, `columns.tsx`, and mobile card list: rename/display as
   assignee where appropriate and add mobile assignee visibility.
3. Dashboard pending/dispatch queues: use `isTripUnassignedForDispatch` and
   query conditions that exclude `fremdfirma_id`.
4. Kanban and print: group by semantic assignee, or intentionally keep "driver"
   mode but exclude/label Fremdfirma.
5. CSV/export/invoice snapshots: add Fremdfirma join and exported assignee fields.

### Hardest Consumer Surface

Kanban plus print export will be the hardest integration because they share the
same driver-column mental model but not a single component:

- Kanban columns are built from active drivers and orphan `driver_id`s.
- Items are bucketed by `trip.driver_id ?? 'unassigned'`.
- Drag-and-drop writes `driver_id` directly.
- Print export reuses `buildColumns(..., 'driver')` for overview images and also
  separately groups PDFs by `trip.driver?.name || 'Nicht zugewiesen'`.

Changing this safely requires deciding whether external companies are:

- their own columns in "driver/assignee" mode,
- excluded from internal driver planning,
- shown in a separate "Extern" bucket,
- or visible but not draggable to internal drivers.

That is a product/domain decision, not just a component refactor. It also has
downstream effects on saved Kanban order, print output, and dispatcher workflow.

### Immediate Risk Summary

The current highest-risk behavior is not the desktop Fahrten table display. That
path already shows Fremdfirma reasonably well.

The highest-risk behavior is every place that treats `driver_id = null` as
"unassigned":

- Fahrten driver filter `Nicht zugewiesen`.
- Dashboard `Offene Touren`.
- Pending assignment inbox.
- Kanban driver grouping.
- Print ZIP grouping.
- Controlling driver aggregation if the RPC emits Fremdfirma rows with
  `driver_id = null`.

The clean fix is to introduce one canonical assignee resolver and one canonical
"unassigned for dispatch" predicate, then replace ad hoc `!driver_id` checks
surface by surface.
