# Tabellenansicht exportieren — Row Count Mismatch & Column Visibility (Audit 2)

**Symptoms (post date-prefill fix):**

- **A)** Table shows **10** rows; export preview shows **11** — one extra row in export that the admin should not see given current table state.
- **B)** **Tabellenansicht exportieren** pre-selects **all** `EXPORT_COLUMN_DEFS` keys regardless of which columns the admin has visible in the table.

**Scope:** Read-only. Compare `trips-listing.tsx` vs `applyExportFilters` / preview route; trace column visibility store vs export registry.

**Date:** 2026-06-19

---

## Executive summary

### Section A — Row count (10 vs 11)

After the date-prefill fix, **export always applies a date filter** (today by default via prefill). The list applies a date filter **only when `scheduled_at` is truthy in the URL** (normally set by `trips-filters-bar.tsx` mount effect). For the default “today” view with `scheduled_at=YYYY-MM-DD`, date semantics are **mostly aligned**, including the today backlog branch — but **not identical** for single-day unscheduled rows (`requested_date.eq` vs `requested_date.gte/lte`).

There is **no** `is_visible`, `is_deleted`, `is_archived`, or `test_trip` column on `trips`. Rows are not hidden via a DB flag in this codebase.

The list query applies **three filter dimensions that export prefill / `applyExportFilters` do not implement at all**. Any active URL value for these will make **export return ≥ list count** (export broader):

| Rank | Gap | List behaviour | Export behaviour | Likely +1? |
|------|-----|----------------|------------------|------------|
| 1 | **`invoice_status`** | RPC `trip_ids_matching_invoice_effective_status` → `.in('id', …)` or `.not('id', 'in', …)` | Not in `ExportFilters`; not in prefill; not in API params | **Yes** — even a preset URL param the user forgot about |
| 2 | **`search`** | `or(client_name.ilike…, pickup_address.ilike…, dropoff_address.ilike…)` | Not mapped | **Yes** |
| 3 | **`driver_id=fremdfirma:all`** | `.not('fremdfirma_id', 'is', null)` | `parseAssigneeFromUrl` → `assigneeFilter: null` (no filter) | **Yes** if filter active |
| 4 | Single-day **`requested_date`** | `requested_date.eq.${dayStr}` | `requested_date.gte/lte` (same YMD bounds) | Unlikely for normal DATE strings |
| 5 | Partial **`scheduled_at`** ranges (`from,` or `,to` only) | Listing has dedicated branches | Prefill falls through to today-only | Possible on edge URLs |
| 6 | **RLS vs service role** | Anon SSR client + RLS (`company_id = current_user_company_id()`) | Service role **bypasses RLS** + explicit `.eq('company_id', companyId)` | **Unlikely +1** for admin — policies are company-scoped only |

**Pagination is not the cause:** `totalTrips` in the list comes from Supabase `count: 'exact'` on the **same filtered query** before `.range()`. If the UI shows “10 Fahrten”, the query-layer count is **10**, not 11 with one row on page 2.

### Section B — Column visibility

Column visibility lives in **`useTripsTableStore`** (Zustand). Table-view export **does not read it** — `csv-export-dialog.tsx` sets `ALL_EXPORT_COLUMN_KEYS` (every registry key).

**Table column IDs and export registry keys do not match 1:1.** Several visible table columns have **no** export key (`invoice_status`, `gross_price`, `fremdfirma`, `reha_schein`, …). Fix requires a **mapping layer**, not a direct store → registry pass-through.

The store **can** be read from `csv-export-dialog.tsx` without circular imports (`useTripsTableStore` does not import export code).

---

## Section A — Row count mismatch (10 vs 11)

### 1. Filters in `trips-listing.tsx` with no equivalent in `applyExportFilters`

Both sides filter on: **status**, **assignee** (partial), **payer_id**, **billing_variant_id**, **KTS** (via `buildKtsTripFilterPlan`), **date** (partial).

**List-only — no export equivalent (ranked by likelihood for +1 row):**

#### 1. `invoice_status` (RPC pre-filter) — **highest likelihood**

**List** (`trips-listing.tsx` lines 75–84, 202–213):

- Reads URL `invoice_status`.
- When value is one of `uninvoiced | draft | sent | paid` (not `all`), calls `resolveInvoiceStatusTripFilter(supabase, …)` → RPC `trip_ids_matching_invoice_effective_status`.
- Applies `.in('id', tripIds)` or `.not('id', 'in', (…))`.
- If RPC returns empty `in` set, **skips the trips query entirely** (`totalTrips = 0`).

**Export:**

- `ExportFilters` has **no** `invoiceStatus` field.
- `useExportFilterPrefill` does **not** read `invoice_status`.
- `buildExportPreviewSearchParams` does **not** serialize it.
- `applyExportFilters` does **not** filter by invoice status.

#### 2. `search` (text) — **high likelihood**

**List** (lines 214–218):

```ts
query = query.or(
  `client_name.ilike.%${term}%,pickup_address.ilike.%${term}%,dropoff_address.ilike.%${term}%`
);
```

**Export:** not in prefill, not in `applyExportFilters`.

#### 3. Assignee `fremdfirma:all` — **medium likelihood**

**List** (lines 129–146): `parseAssigneeParam` → `fremdfirma_all` → `.not('fremdfirma_id', 'is', null)`.

**Export prefill** (`use-export-filter-prefill.ts` lines 41–54): `parseAssigneeFromUrl` maps `fremdfirma_all` to **`null`** (same as “all drivers”) — **no assignee filter applied**.

Also missing from export assignee schema: only `driver | fremdfirma | unassigned` (`export-query.ts` lines 47–58).

#### 4. Date filter — **partial parity (lower likelihood for +1 after recent fix)**

**List** applies date filter **only inside `if (scheduledAt)`** (line 234). If `scheduled_at` is absent, **no date WHERE** is added (entire table for company via RLS).

**Export** always applies date via `applyExportFilters` (required `dateFrom` / `dateTo`).

For **single-day YMD** (`scheduled_at=2026-06-19`), after the prefill fix both sides target the same day. Remaining differences:

| Aspect | List (single-day YMD) | Export (`applyExportFilters`) |
|--------|----------------------|-------------------------------|
| Scheduled in day | `scheduled_at.gte.${startISO},scheduled_at.lt.${endExclusiveISO}` | Same bounds via `getZonedDayBoundsIso` |
| Unscheduled + `requested_date` | `requested_date.eq.${dayStr}` | `requested_date.gte.${dateFrom},requested_date.lte.${dateTo}` |
| Today backlog | `and(scheduled_at.is.null,requested_date.is.null)` when `dayStr === todayYmdInBusinessTz()` | Same when `dateFrom === dateTo === todayYmdInBusinessTz()` |
| Partial comma ranges (`from,` / `,to`) | Dedicated branches (lines 254–277) | Prefill only handles two valid epoch ms; else today fallback |

**Absent `scheduled_at`:** prefill now defaults to **today**; list applies **no date filter** until filters bar mount effect sets URL — transient only.

#### 5. Not present in either path

- **Soft-delete / archived / hidden row flags:** no `is_visible`, `is_deleted`, `is_archived`, `deleted_at`, or `test_trip` on `trips` in `database.types.ts` or listing/export queries.
- **Explicit `company_id` in list query:** list relies on **RLS** only; export adds `.eq('company_id', companyId)` (see §4).
- **Client-side row filtering:** no `getFilteredRowModel` / global filter in `TripsTable` — rows shown = server query result (paginated).

#### 6. Joins / embeds

List and export use different `select` embeds (list: payer/billing/assignee; export: payer/billing/driver/fremdfirma). **Joins do not filter rows** — they only shape returned columns.

---

### 2. “Hidden trips” concept

**No.** There is no column or flag in the audited code that hides trips from the table while leaving them in the export query. Exclusion is purely **query filters** (URL-driven on the list; `ExportFilters` on export).

Cancelled trips appear when `status` filter is `all` / absent — both paths include them unless `status` is filtered.

---

### 3. Pagination-independent filters that reduce list count below export

**Yes — query-layer filters, not pagination:**

| Filter | Reduces list count when active? | In export? |
|--------|--------------------------------|------------|
| `invoice_status` | Yes | **No** |
| `search` | Yes | **No** |
| `fremdfirma:all` | Yes (subset) | **No** |
| `status`, payer, billing, KTS | Yes | Yes (when URL mapped) |
| Date | Yes (when `scheduled_at` set) | Yes (always) |

**Pagination:** `.range(from, to)` (lines 332–335) limits **returned rows**, not `count`. `totalTrips = count || 0` (line 342) is the full filtered cardinality.

**Default sorting** (`order('scheduled_at')`) does not change count.

---

### 4. Supabase auth context — list vs export preview

#### List — `trips-listing.tsx`

```ts
const supabase = await createClient();
// ...
let query = supabase.from('trips').select(..., { count: 'exact' });
// No .eq('company_id', …) — scoping via RLS
```

**Client:** [`src/lib/supabase/server.ts`](../src/lib/supabase/server.ts) — `createServerClient(url, **anonKey**, { cookies })`. User session JWT from Clerk/Supabase auth cookies.

**RLS** ([`supabase/migrations/20260409170000_add_missing_rls.sql`](../supabase/migrations/20260409170000_add_missing_rls.sql)):

```sql
CREATE POLICY trips_select_company_admin ON public.trips
  FOR SELECT TO authenticated
  USING (
    public.current_user_is_admin()
    AND company_id = public.current_user_company_id()
  );
```

#### Export preview — `GET /api/trips/export/preview/route.ts`

```ts
const auth = await requireAdmin(); // uses createClient() + accounts.role check
const companyId = auth.companyId;

const admin = createAdminClient<Database>(supabaseUrl, serviceRoleKey);

let countQuery = admin
  .from('trips')
  .select('*', { count: 'exact', head: true })
  .eq('company_id', companyId);

countQuery = applyExportFilters(countQuery, filters);
```

**Client:** `@supabase/supabase-js` with **`SUPABASE_SERVICE_ROLE_KEY`** — **bypasses RLS**.

**Company scope:** export uses `companyId` from `requireAdmin()` (same `accounts.company_id` as the logged-in admin). For a normal admin session, the visible row set should match RLS **except** where export applies **broader filters** (missing `invoice_status`, `search`, etc.) — export can be **strictly larger**, not smaller, for those gaps.

**Not the likely +1 cause** when no extra filters are active and RLS is company-only.

---

### 5. Is the list total 10 or 11 at query layer?

**Cannot be determined from code alone** — requires the live URL params and DB state for the repro session.

**What the code guarantees:**

- `TripsFiltersBar` receives `totalItems={totalTrips}` from the RSC count (line 375).
- That count is **`count: 'exact'` from the filtered query before `.range()`** (lines 338–342).
- If the admin sees **“10 Fahrten”** in the filter bar / pagination chrome, **`totalTrips === 10` at query layer**.
- Export preview `count` comes from a **separate** query (`preview/route.ts` lines 74–79) with **`applyExportFilters` only** — if it returns **11**, the mismatch is **query-layer**, not pagination.

**Debugging the +1 row:** diff list URL params vs `buildExportPreviewSearchParams` output; check especially `invoice_status`, `search`, `driver_id=fremdfirma:all`. Identify the extra trip: likely matches export date scope but fails a list-only filter.

---

## Section B — Column visibility mapping

### 6. Where visibility state lives

| Item | Detail |
|------|--------|
| **File** | [`src/features/trips/stores/use-trips-table-store.ts`](../src/features/trips/stores/use-trips-table-store.ts) |
| **Store name** | `useTripsTableStore` (Zustand `create`) |
| **Shape** | `columnVisibility: VisibilityState` — TanStack **`Record<string, boolean>`** (`false` = hidden; key absent = visible by default) |
| **Default in store** | `{}` (empty) |
| **Default in table** | [`trips-tables/index.tsx`](../src/features/trips/components/trips-tables/index.tsx) lines 56–61 — `initialState.columnVisibility`: `{ net_price: false, tax_rate: false, reha_schein: false }` |
| **Canonical default (presets)** | [`ansichten-dropdown.tsx`](../src/features/trips/components/ansichten-dropdown.tsx) lines 58–62 — same three keys hidden |
| **Sync** | `TripsTable` effect mirrors `table.getState().columnVisibility` → store (index.tsx lines 98–101) |

Also on store: `columnOrder`, `table` ref, `pendingColumnVisibility` / `pendingColumnOrder` for preset application.

---

### 7. Table column visibility keys (exact strings)

From [`columns.tsx`](../src/features/trips/components/trips-tables/columns.tsx) column `id`s and [`DEFAULT_COLUMN_ORDER`](../src/features/trips/components/ansichten-dropdown.tsx) lines 69–93:

```
select
scheduled_at
time
name
pickup_address
dropoff_address
driver_id
status
gross_price
invoice_status
payer_name
fremdfirma
fremdfirma_abrechnung
billing_type
billing_calling_station
billing_betreuer
kts_document_applies
kts_fehler
kts_fehler_beschreibung
reha_schein
net_price
tax_rate
actions
```

**Hidden by default:** `net_price`, `tax_rate`, `reha_schein` (`false` in initial visibility).

**Not hideable (UI):** `select`, `actions` (`enableHiding: false` in columns.tsx lines 85, 631).

**“Spalten” popover** ([`trips-filters-bar.tsx`](../src/features/trips/components/trips-filters-bar.tsx) lines 439–485): lists `hidableColumns` — columns with `accessorFn` defined and `getCanHide()`.

---

### 8. `EXPORT_COLUMN_DEFS` keys (exact strings)

From [`export-columns.registry.ts`](../src/features/trips/lib/export-columns.registry.ts) lines 77–402:

```
id
scheduled_date
scheduled_time
requested_date
status
is_wheelchair
return_status
link_type
canceled_reason_notes
created_at
client_id
client_name
client_phone
greeting_style
pickup_address
pickup_street
pickup_street_number
pickup_zip_code
pickup_city
pickup_station
pickup_lat
pickup_lng
dropoff_address
dropoff_street
dropoff_street_number
dropoff_zip_code
dropoff_city
dropoff_station
dropoff_lat
dropoff_lng
payer_id
payer_name
billing_variant_id
billing_variant_name
billing_family_name
billing_calling_station
billing_betreuer
kts_document_applies
net_price
driver_id
driver_name
vehicle_id
group_id
stop_order
notes
driving_distance_km
driving_duration_seconds
actual_pickup_at
actual_dropoff_at
company_id
ingestion_source
rule_id
linked_trip_id
has_missing_geodata
needs_driver_assignment
```

**Count:** 57 keys.

---

### 9. Visibility keys ↔ export registry mapping

| Table visibility key | Export registry key(s) | Match? |
|----------------------|------------------------|--------|
| `select` | — | UI only — no export |
| `scheduled_at` | `scheduled_date` | Partial — table “Datum”; export splits date/time |
| `time` | `scheduled_time` | Partial — duplicate table column, same underlying field |
| `name` | `client_name` | Rename |
| `pickup_address` | `pickup_address` | ✓ |
| `dropoff_address` | `dropoff_address` | ✓ |
| `driver_id` | `driver_name` (also `driver_id`) | Partial — table shows name |
| `status` | `status` | ✓ |
| `gross_price` | — | **Missing in export** (export has `net_price`, not gross) |
| `invoice_status` | — | **Missing in export** |
| `payer_name` | `payer_name` | ✓ |
| `fremdfirma` | — | **Missing** (join exists in export select, no column def) |
| `fremdfirma_abrechnung` | — | **Missing** (`fremdfirma_payment_mode` not in registry) |
| `billing_type` | `billing_variant_name`, `billing_family_name` | Partial — table uses combined display label |
| `billing_calling_station` | `billing_calling_station` | ✓ |
| `billing_betreuer` | `billing_betreuer` | ✓ |
| `kts_document_applies` | `kts_document_applies` | ✓ |
| `kts_fehler` | — | **Missing** |
| `kts_fehler_beschreibung` | — | **Missing** |
| `reha_schein` | — | **Missing** |
| `net_price` | `net_price` | ✓ |
| `tax_rate` | — | **Missing** |
| `actions` | — | UI only — no export |

**Export-only keys (no table column):** e.g. `id`, `requested_date`, `is_wheelchair`, address subfields (`pickup_street`, …), `payer_id`, `billing_variant_id`, `vehicle_id`, `group_id`, `notes`, technical/metadata fields — **39+ keys** with no table visibility toggle.

**Conclusion:** **Not 1:1.** A fix must:

1. Map each **visible** table column id → one or more export keys (or skip non-exportable UI columns).
2. Decide policy for export-only columns (omit from table-view export vs include when “related” column visible).
3. Handle split columns (`scheduled_at` → `scheduled_date` + `scheduled_time`; `billing_type` → variant/family).

---

### 10. Where visibility is read to show/hide columns

**Not in `trips-listing.tsx`** (server component — no visibility state).

**TanStack Table** applies visibility internally via `useDataTable` → `DataTable` / `TripsMobileCardList`.

**Store write path:** [`trips-tables/index.tsx`](../src/features/trips/components/trips-tables/index.tsx) lines 98–101 — syncs `table.getState().columnVisibility` to `useTripsTableStore`.

**Store read paths:**

- [`trips-filters-bar.tsx`](../src/features/trips/components/trips-filters-bar.tsx) lines 126–140, 461–466 — “Spalten” popover toggles via `column.toggleVisibility()`.
- [`ansichten-dropdown.tsx`](../src/features/trips/components/ansichten-dropdown.tsx) — preset compare / apply.
- [`use-apply-trip-preset.ts`](../src/features/trips/hooks/use-apply-trip-preset.ts) — preset activation.

**Table-view export today:** [`csv-export-dialog.tsx`](../src/features/trips/components/csv-export/csv-export-dialog.tsx) lines 33, 132:

```ts
const ALL_EXPORT_COLUMN_KEYS = EXPORT_COLUMN_DEFS.map((col) => col.key);
// ...
setSelectedColumns(ALL_EXPORT_COLUMN_KEYS);
```

Does **not** read `useTripsTableStore`.

---

### 11. Can export code read the store without circular deps?

**Yes.**

| Module | Imports |
|--------|---------|
| `use-trips-table-store.ts` | `zustand`, `@tanstack/react-table` only |
| `csv-export-dialog.tsx` | export types, prefill hook, export-query, registry — **no** store today |
| `use-export-filter-prefill.ts` | URL parsers, csv-export types — **no** store today |

**Recommended read site:** `csv-export-dialog.tsx` (table-view branch in open effect) via:

```ts
import { useTripsTableStore } from '@/features/trips/stores/use-trips-table-store';
// selector or getState().columnVisibility
```

**Caveat:** store `columnVisibility` is `{}` until `TripsTable` mounts and syncs; on Kanban view `table` may be null — fall back to `DEFAULT_COLUMN_VISIBILITY` from `ansichten-dropdown.tsx` or table `initialState`.

**Prefill hook:** could read store, but column selection is **wizard state**, not URL — keep mapping in dialog, not `use-export-filter-prefill`.

---

## Recommended next steps (out of scope for this audit)

### A — Row count parity

1. Reproduce with browser: copy full trips URL when table shows 10; compare to preview request query string.
2. If `invoice_status` or `search` present → extend `ExportFilters` + prefill + `applyExportFilters` (invoice needs RPC like listing).
3. Map `fremdfirma:all` → new assignee export type or dedicated filter.
4. Optional: align single-day unscheduled branch to `requested_date.eq` for exact list parity.

### B — Column pre-select

1. Add `TABLE_COLUMN_TO_EXPORT_KEYS: Record<string, string[]>` (shared, server-safe subset for keys only).
2. In table-view open effect: visible keys = table columns where `columnVisibility[id] !== false`, map → dedupe export keys; exclude `select` / `actions`.
3. Handle defaults when store empty (Kanban / before mount).
4. Document non-exportable visible columns (`invoice_status`, `gross_price`, …) — omit or add registry entries later.

---

## File reference index

| File | Role |
|------|------|
| `trips-listing.tsx` | RSC list query + all URL filters |
| `export-query.ts` | `applyExportFilters`, preview param builders |
| `preview/route.ts` | Service-role count + sample |
| `use-export-filter-prefill.ts` | URL → `ExportFilters` (no invoice/search/fremdfirma_all) |
| `use-trips-table-store.ts` | Column visibility mirror |
| `export-columns.registry.ts` | 57 export keys |
| `csv-export-dialog.tsx` | Table-view: `ALL_EXPORT_COLUMN_KEYS` |
| `trips-filters-bar.tsx` | Column toggle UI + `scheduled_at` default |
