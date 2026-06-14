# KTS PR2 — Fahrten table correction columns audit

**Date:** 2026-06-10  
**Scope:** Read-only list columns for `kts_corrections` summary data (count + latest round fields).  
**Constraint:** Audit only — no implementation in this document.

**Planned columns (per trip row):**

| # | Label (DE) | Source |
|---|------------|--------|
| 1 | Anzahl Korrekturen | `COUNT(*)` of correction rounds |
| 2 | Letzte Korrektur gesendet an | `sent_to` of most recent round |
| 3 | Letzte Korrektur gesendet am | `sent_at` of most recent round |
| 4 | Korrektur erhalten | `received_at` of most recent round (empty if open) |

---

## Executive summary

The Fahrten list already has a proven pattern for **supplementary, joined-table data**: defer loading from the main RSC query and fetch summaries in a **second client query** keyed by visible trip IDs (`TripInvoiceStatusesProvider` + `fetchTripInvoiceStatuses`). Correction columns should follow that pattern, backed by a **compact SQL RPC** (or view) that returns one summary row per trip — not a raw one-to-many embed on the main list query.

**Senior recommendation:** RPC + deferred client hook (mirror invoice badges). Use a sibling RPC for server-side “open correction” filtering when needed. Do **not** extend `trips-listing.tsx` with `kts_corrections(...)` embed for list view.

---

## 1. Column definition pattern

**File:** [`src/features/trips/components/trips-tables/columns.tsx`](../src/features/trips/components/trips-tables/columns.tsx)

### How columns are registered

All list columns are a single exported `columns: ColumnDef<any>[]` array. TanStack Table is wired in [`trips-tables/index.tsx`](../src/features/trips/components/trips-tables/index.tsx) via `useDataTable({ columns, ... })`.

### Minimum required for a read-only column

| Piece | Required? | Notes |
|-------|-----------|-------|
| `id` | **Yes** | Stable string used by Ansichten, URL `?sort=`, column visibility state. Use snake_case matching domain (`kts_correction_count`, etc.). |
| `accessorKey` **or** `accessorFn` | **One of** | Scalar trip fields use `accessorKey` (e.g. `kts_document_applies`). Derived / non-scalar fields use `accessorFn`. |
| `header` | **Yes** | Typically `<DataTableColumnHeader column={column} title='…' />` for sort UI affordance. |
| `cell` | **Yes** | Read-only display; `row.original` for trip id + context hook for correction summary. |
| `meta.label` | **Strongly recommended** | German label for **Spalten** popover and Ansichten (`trips-filters-bar.tsx` reads `column.columnDef.meta?.label`). |
| `enableColumnFilter` | Set `false` | Table column filters are not used for KTS today; server filters live in RSC + URL params. |
| `enableSorting` | `false` unless mapped | See §6. |
| `enableHiding` | Default `true` | Only `select` and `actions` set `enableHiding: false`. |

### Reference patterns in `columns.tsx`

**Scalar read-only (trips table column):**

```typescript
{
  id: 'gross_price',
  accessorKey: 'gross_price',
  header: ({ column }) => <DataTableColumnHeader column={column} title='Brutto' />,
  cell: ({ row }) => { /* format or em dash */ },
  enableColumnFilter: false
}
```

**Derived / joined data — deferred client fetch (best model for PR2):**

```326:345:src/features/trips/components/trips-tables/columns.tsx
  {
    id: 'invoice_status',
    // Synthetic accessor so the column appears in the Spalten popover (`hidableColumns` requires accessorFn).
    accessorFn: () => '',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Rechnungsstatus' />
    ),
    // Rechnungsstatus: deferred client fetch — see TripInvoiceStatusesProvider + docs/trips-performance.md
    cell: ({ row }) => {
      const id = row.original.id as string;
      return (
        <div className='flex justify-center px-1'>
          <TripInvoiceStatusBadgeCell tripId={id} />
        </div>
      );
    },
    meta: { label: 'Rechnungsstatus', variant: 'text' },
    enableColumnFilter: false,
    // No scalar `trips` column; sort would need RPC/view — deferred.
    enableSorting: false
  },
```

**Text from row with `accessorFn` + read-only cell:**

```462:487:src/features/trips/components/trips-tables/columns.tsx
  {
    id: 'billing_calling_station',
    accessorFn: (row) => row.billing_calling_station ?? '',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Anrufstation' />
    ),
    cell: ({ row }) => { /* trim, em dash */ },
    meta: { label: 'Anrufstation', variant: 'text' },
    enableColumnFilter: false
  },
```

### Spalten popover visibility

[`trips-filters-bar.tsx`](../src/features/trips/components/trips-filters-bar.tsx) builds `hidableColumns` with:

```typescript
table.getAllColumns().filter(
  (col) => typeof col.accessorFn !== 'undefined' && col.getCanHide()
);
```

TanStack assigns an implicit `accessorFn` for `accessorKey` columns, but **deferred/joined columns explicitly use `accessorFn: () => ''`** (see `invoice_status` comment). PR2 correction columns should use the same synthetic `accessorFn` + dedicated cell components reading from a provider.

### PR2 column implementation checklist (`columns.tsx`)

1. Add four `ColumnDef` entries after existing KTS columns (or grouped after `kts_fehler_beschreibung`).
2. Each: `id`, `accessorFn: () => ''`, `header`, `cell` → thin wrapper like `KtsCorrectionCountCell`, `meta.label`, `enableColumnFilter: false`, `enableSorting: false`.
3. No inline editing; no `KtsCellGroupProvider` (that is only for optimistic KTS toggles in [`kts-cells.tsx`](../src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx)).

---

## 2. Data availability

**File:** [`src/features/trips/components/trips-listing.tsx`](../src/features/trips/components/trips-listing.tsx)

### Current list query shape

List view does **not** use bare `select('*')` alone. It uses an explicit multi-line select:

```100:106:src/features/trips/components/trips-listing.tsx
    const tripsListSelect = `
    *,
    payer:payers(name, reha_schein_enabled),
    billing_variant:billing_variants(name, code, billing_types(name, color)),
    driver:accounts!trips_driver_id_fkey(name),
    fremdfirma:fremdfirmen(id, name, default_payment_mode)
  `;
```

Kanban uses the same embeds **plus** `invoice_line_items → invoices` (legacy; list view intentionally omits this).

### Can the main query embed `kts_corrections`?

**Technically yes** (PostgREST resource embedding), e.g.:

```sql
kts_corrections(sent_to, sent_at, received_at, created_at)
```

**Practically discouraged for list view** because:

1. **One-to-many cardinality** — each trip returns an **array** of all rounds; payload grows with history, not with page size alone.
2. **“Latest round” is not free** — UI needs aggregation (`MAX(created_at)`, count). Either client-side reduce per row or embed modifiers (`.order(created_at.desc).limit(1)`) which still omit count and are easy to get wrong.
3. **Columns are opt-in** — loading all correction rows when columns are hidden wastes work (same reason invoice embed was removed from list — see [`docs/trips-performance.md`](../trips-performance.md)).
4. **Filter/sort on “latest open round”** does not map cleanly to PostgREST parent filters on child rows (see §5).

### Existing pattern for joined supplementary data

| Concern | Mechanism |
|---------|-----------|
| **Display** (Rechnungsstatus) | RSC returns trips only → `TripInvoiceStatusesProvider` → `useTripInvoiceStatuses(tripIds)` → `fetchTripInvoiceStatuses` |
| **Filter** (Rechnungsstatus URL) | Pre-query RPC `trip_ids_matching_invoice_effective_status` → `.in('id', tripIds)` on main query |

Invoice data **does not** come from the list RSC embed (list view). Kanban is the exception still embedding `invoice_line_items`.

### PR2 data layer implication

- **Do not** add `kts_corrections` to `tripsListSelect` for desktop list.
- Add `fetchTripKtsCorrectionSummaries(tripIds)` (name TBD) in [`trips.service.ts`](../src/features/trips/api/trips.service.ts).
- Add `TripKtsCorrectionSummariesProvider` + `useTripKtsCorrectionSummaries` parallel to invoice context/hook.
- Wrap `TripsTable` with the provider (same placement as `TripInvoiceStatusesProvider` in [`trips-tables/index.tsx`](../src/features/trips/components/trips-tables/index.tsx)).

---

## 3. TypeScript types

### Current types

[`trips.service.ts`](../src/features/trips/api/trips.service.ts):

```typescript
export type Trip = Database['public']['Tables']['trips']['Row'];
export type TripListRow = Trip & { payer: TripListPayerEmbed | null };
```

List RSC casts query results:

```typescript
trips = (data ?? []) as unknown as TripListRow[];
```

[`kts-cells.tsx`](../src/features/trips/components/trips-tables/inline-cells/kts-cells.tsx) defines a **local** `TripRow = Trip & { payer: … }` for inline cells — not shared with `TripListRow`.

### If corrections were embedded on the main query

Would need something like:

```typescript
export type TripListKtsCorrectionEmbed = {
  sent_to: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_at: string;
};

export type TripListRow = Trip & {
  payer: TripListPayerEmbed | null;
  kts_corrections?: TripListKtsCorrectionEmbed[]; // array — awkward for columns
};
```

Types are **manual**; Supabase client does not infer RSC select strings. `database.types.ts` will gain `kts_corrections` table types after PR2 migration — embed shape must still be declared by hand.

### Recommended types (deferred fetch)

Keep `TripListRow` unchanged. Add summary DTO + fetch return type (mirror invoice):

```typescript
export type TripKtsCorrectionSummary = {
  trip_id: string;
  correction_count: number;
  latest_sent_to: string | null;
  latest_sent_at: string | null;
  latest_received_at: string | null;
  /** Derived: latest_sent_at IS NOT NULL AND latest_received_at IS NULL */
  has_open_correction: boolean;
};
```

Column cells consume `Map<tripId, TripKtsCorrectionSummary>` from context — same as `lineItemsByTripId` for invoices.

---

## 4. Column visibility (Ansichten)

### Two UI surfaces

| Surface | Location | How columns appear |
|---------|----------|-------------------|
| **Spalten** popover | `trips-filters-bar.tsx` | Auto: all hidable TanStack columns (`accessorFn` + `getCanHide()`). Uses `meta.label`. |
| **Ansichten** presets | `ansichten-dropdown.tsx`, `ansichten-sheet.tsx` | **Manual** lists: `DEFAULT_COLUMN_ORDER`, `DEFAULT_COLUMN_VISIBILITY`, `EDITOR_COLUMNS`. |

There is **no** auto-sync from `columns.tsx` to Ansichten sheet — new columns require explicit updates in three places.

### Default visibility convention

[`trips-tables/index.tsx`](../src/features/trips/components/trips-tables/index.tsx) `initialState.columnVisibility`:

```56:61:src/features/trips/components/trips-tables/index.tsx
      columnVisibility: {
        net_price: false,
        tax_rate: false,
        reha_schein: false
      }
```

Same object duplicated as `DEFAULT_COLUMN_VISIBILITY` in [`ansichten-dropdown.tsx`](../src/features/trips/components/ansichten-dropdown.tsx) (comment: must stay aligned).

**Existing KTS columns** (`kts_document_applies`, `kts_fehler`, `kts_fehler_beschreibung`) are **visible by default** (not listed in `columnVisibility` → TanStack treats as visible).

### Recommendation for correction columns

**Opt-in, hidden by default** — supplementary admin columns, same class as `reha_schein` / `net_price`:

- Add to `initialState.columnVisibility` / `DEFAULT_COLUMN_VISIBILITY`: all four ids → `false`.
- Add to `DEFAULT_COLUMN_ORDER` (after KTS block) and `EDITOR_COLUMNS` in `ansichten-sheet.tsx` with German labels.
- Presets saved before PR2 will pick up new columns via `buildInitialDraftOrder` “missing middle” merge — new columns append at end of middle block until user reorders.

### Ansichten filters note

`kts_filter` URL param is **not** part of trip presets (`TRIP_PRESET_PARAM_KEYS` in [`trip-preset.types.ts`](../src/features/trips/types/trip-preset.types.ts) omits it). Column visibility **is** stored in presets. Correction **filters** (if added) would be a separate product decision (preset whitelist extension).

---

## 5. Filtering

### Existing KTS filters

URL: `kts_filter` comma-separated tokens (`kts`, `kts_fehler`, `no_kts`, `no_reha`, `reha`).

Applied in `trips-listing.tsx` as PostgREST filters on **`trips` columns only** — `.eq('kts_document_applies', true)`, `.eq('kts_fehler', true)`, `.or(...)` for multi-select.

Client: [`trips-filters-bar.tsx`](../src/features/trips/components/trips-filters-bar.tsx) `KTS_FILTER_OPTION_ROWS` + `updateFilters({ kts_filter })`.

### Should correction columns be filterable?

**Display columns:** no table-level filter required.  
**Product filter “has open correction”** (latest round `sent_at` set, `received_at` null): **yes, but not via column meta** — needs URL + RSC like `invoice_status`.

### Mechanism options

| Approach | Works for paginated list? | “Latest round open”? |
|----------|---------------------------|----------------------|
| PostgREST embed filter e.g. `kts_corrections.received_at.is.null` | Yes | **No** — matches *any* round, not latest |
| Client-side filter on current page | N/A | Wrong — breaks pagination/count |
| Denormalized `trips` flag (e.g. `kts_has_open_correction`) | Yes | Yes, if maintained on write |
| **RPC** returning `trip_id` set | Yes | Yes, with SQL window/`DISTINCT ON` |

### Precedent: invoice status

[`resolve-invoice-status-trip-filter.ts`](../src/features/trips/lib/resolve-invoice-status-trip-filter.ts) calls `trip_ids_matching_invoice_effective_status` **before** the main trips query; empty result short-circuits to zero rows.

### Verdict

- **Minimum viable “open correction” filter:** new RPC e.g. `trip_ids_with_open_kts_correction()` (or parameterised `trip_ids_matching_kts_correction_state`) + new URL token e.g. `kts_filter=korrektur_offen` or separate `kts_correction_filter`.
- **Not achievable** correctly with current architecture using only PostgREST embedded filters on a one-to-many relation without RPC/view/denormalization.
- **Defer filter to PR2.1** if schema ships first; columns can ship read-only without filter.

---

## 6. Sort

**File:** [`src/features/trips/trips-sort-map.ts`](../src/features/trips/trips-sort-map.ts)

Server sort in `trips-listing.tsx`:

```typescript
const mapping = TRIPS_SORT_MAP[sortRule.id];
query = query.order(mapping.column, { foreignTable?: mapping.foreignTable });
```

`TRIPS_SORTABLE_IDS` whitelists URL `?sort=` parsing (client + RSC must match).

### Mapped today

Trips scalars + embeds: `payer`, `driver`, `billing_variant` via `foreignTable`. Includes `kts_document_applies`.

### Explicitly **not** sortable (convention)

Columns with no `TRIPS_SORT_MAP` entry set `enableSorting: false` in `columns.tsx`:

- `invoice_status` — comment: “sort would need RPC/view”
- `fremdfirma`, `fremdfirma_abrechnung`

### Correction columns

- Data lives on joined / aggregated table → **no server-side sort** in PR2 without a database view or RPC-backed sort key.
- **Convention:** `enableSorting: false` on all four columns; do **not** add entries to `TRIPS_SORT_MAP`.
- Client-side sort via TanStack would only reorder the current page — inconsistent with server pagination; avoid.

---

## 7. Mobile card list

**File:** [`src/features/trips/components/trips-tables/trips-mobile-card-list.tsx`](../src/features/trips/components/trips-tables/trips-mobile-card-list.tsx)

### Behaviour today

- Used when `useIsNarrowScreen(768)` in `TripsTable` (not a separate route).
- Renders a **subset** of trip fields: time, date, passenger, status, addresses, wheelchair icon.
- **KTS:** single conditional badge when `trip.kts_document_applies` (from main RSC row — no extra fetch):

```160:168:src/features/trips/components/trips-tables/trips-mobile-card-list.tsx
                    {trip.kts_document_applies ? (
                      <Badge variant='secondary' className='px-1.5 py-0 text-[10px] font-normal' …>
                        KTS
                      </Badge>
                    ) : null}
```

- **Does not show:** invoice status, Fremdfirma, billing, correction fields, net/tax, inline KTS switches.

`TripInvoiceStatusesProvider` wraps mobile list too, but mobile UI does not consume it.

### PR2 implication

| Option | Effort | Recommendation |
|--------|--------|----------------|
| Desktop table only | Lowest | **Default** — matches invoice/Fremdfirma mobile omission |
| Optional badge “Korrektur offen” | Low | Only if product wants parity; reuse summary provider + `has_open_correction` |
| Full four fields on cards | High | Not recommended |

---

## Senior recommendation: data loading strategy

### Ranked options

| Rank | Approach | Pros | Cons |
|------|----------|------|------|
| **1 (recommended)** | **RPC summary + deferred client query** | One row per trip; correct latest-round semantics; small payload; same pattern as invoice badges; enables filter RPC family; columns hidden → query can still run (cheap) or gate on visibility later | New migration + provider boilerplate |
| 2 | Embedded `kts_corrections` on RSC select | No extra round-trip | Array bloat; client aggregation; loads when columns hidden; bad filter/sort story |
| 3 | Separate hook per column / per trip | Simple mentally | N+1 or 4× query overhead |
| 4 | Denormalized columns on `trips` | Fast filter/sort | Write-path complexity; duplicates `kts_corrections` |

### Proposed shape (option 1)

**SQL (PR2 migration):**

```sql
-- Example: returns one row per input trip_id with latest round + count
trip_kts_correction_summaries(p_trip_ids uuid[])
  → trip_id, correction_count, latest_sent_to, latest_sent_at, latest_received_at
```

Implementation detail: `DISTINCT ON (trip_id) … ORDER BY trip_id, created_at DESC` + `COUNT(*) OVER (PARTITION BY trip_id)` or two-step CTE.

**Filter RPC (PR2 or PR2.1):**

```sql
trip_ids_with_open_kts_correction()
  -- latest round per trip where sent_at IS NOT NULL AND received_at IS NULL
```

**Client:**

- `fetchTripKtsCorrectionSummaries(tripIds)` in `trips.service.ts`
- `tripKeys.ktsCorrectionSummaries(tripIds)` in `src/query/keys/trips.ts`
- `useTripKtsCorrectionSummaries` hook (`staleTime` = `TRIP_REFERENCE_STALE_TIME_MS`, same as invoice)
- `TripKtsCorrectionSummariesProvider` wrapping table (pass `invoiceStatusTripIds`-style ids from RSC)
- Invalidate via existing `tripKeys.all` on `refreshTripsPage()`

**RSC (`trips-listing.tsx`):** leave `tripsListSelect` unchanged.

### Why not embed?

[`docs/trips-performance.md`](../trips-performance.md) documents the intentional split for invoice line items. `kts_corrections` is the same class of problem (secondary UI, joined data, non-scalar aggregation), with the added difficulty of **one-to-many** history.

### PR2 file touch list (implementation reference)

| File | Change |
|------|--------|
| `columns.tsx` | Four read-only columns + cell components |
| `trips-tables/index.tsx` | Provider wrap; default `columnVisibility` |
| `ansichten-dropdown.tsx` | `DEFAULT_COLUMN_ORDER`, `DEFAULT_COLUMN_VISIBILITY` |
| `ansichten-sheet.tsx` | `EDITOR_COLUMNS` entries |
| `trips.service.ts` | Summary type + fetch |
| `trip-invoice-statuses-context.tsx` (or new sibling) | Provider + context |
| `hooks/use-trip-kts-correction-summaries.ts` | TanStack query |
| `query/keys/trips.ts` | Query key factory |
| `supabase/migrations/…` | `kts_corrections` table + summary RPC (+ optional filter RPC) |
| `trips-sort-map.ts` | No new entries |
| `trips-listing.tsx` | Filter RPC wiring only if “open correction” filter ships |
| `trips-filters-bar.tsx` | Optional new KTS filter token |
| `trips-mobile-card-list.tsx` | Optional badge only |
| `database.types.ts` | Regenerate after migration |

---

## Related docs

- [`docs/kts-architecture.md`](../kts-architecture.md) — PR2 scope, `kts_corrections` vs `kts_reviews`
- [`docs/plans/kts-module-a-architecture-audit.md`](kts-module-a-architecture-audit.md) — satellite table design
- [`docs/trips-performance.md`](../trips-performance.md) — deferred invoice status pattern
