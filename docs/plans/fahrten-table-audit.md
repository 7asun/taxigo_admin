# Fahrten Table Audit

**Scope:** `/dashboard/trips` — **List** view (not Regelfahrten, not Kanban). Read-only; based on the codebase as of the audit date.  
**Primary implementation:** RSC `trips-listing.tsx` + client `TripsTable` + shared `useDataTable`.

## Resolution (2026-04 — sort contract + price columns)

The following audit risks were **addressed** in code:

- **Generic PostgREST `.order(sortRule.id)`** — Replaced with **`TRIPS_SORT_MAP`** in [`src/features/trips/trips-sort-map.ts`](../../src/features/trips/trips-sort-map.ts): only mapped column ids apply `.order()`; unmapped ids are skipped so crafted or stale `?sort=` values no longer 500 the RSC.
- **Client vs RSC sort URL mismatch** — **`getSortingStateParser(TRIPS_SORTABLE_IDS)`** is used in both [`trips-listing.tsx`](../../src/features/trips/components/trips-listing.tsx) and `TripsTable` via **`sortParserValidKeys`** on [`useDataTable`](../../src/hooks/use-data-table.ts). Shared [`searchparams.ts`](../../src/lib/searchparams.ts) was **not** changed.
- **Address columns without explicit `id`** — `pickup_address` and `dropoff_address` column ids match the map and whitelist.
- **Brutto / Netto / MwSt.** — Optional list columns (`gross_price`, `net_price`, `tax_rate`), **hidden by default** via `initialState.columnVisibility`; `tax_rate` display uses decimal fractions (e.g. `0.07`) as in the price engine.

**Deferred (unchanged by design here):**

- **Rechnungsstatus** — No server sort (embed-derived); column has **`enableSorting: false`**.
- **Fremdfirma / Abrechnung Fremdfirma** — No server sort in this change; **`enableSorting: false`**.
- **URL bookmark** — Legacy `sort=date.*` still maps via `date` → `scheduled_at` in `TRIPS_SORT_MAP`. Bookmarks that used only non-mapped ids may fall back to default ordering.

---

## 1. File Map

| Role | Path |
|------|------|
| Next.js page (RSC) | `src/app/dashboard/trips/page.tsx` |
| Client shell (`TripsRscRefreshProvider`) | `src/app/dashboard/trips/fahrten-page-shell.tsx` |
| Header toolbar (client) | `src/app/dashboard/trips/trips-header-actions.tsx` |
| RSC: filters, Supabase query, list vs kanban | `src/features/trips/components/trips-listing.tsx` |
| Table + `useDataTable` wiring, mobile list | `src/features/trips/components/trips-tables/index.tsx` |
| Column definitions | `src/features/trips/components/trips-tables/columns.tsx` |
| URL pagination + sort state (nuqs) + TanStack options | `src/hooks/use-data-table.ts` |
| Shared `DataTable` UI (dnd, scroll) | `src/components/ui/table/data-table.tsx` |
| Sortable header control | `src/components/ui/table/data-table-column-header.tsx` |
| `sort` URL parse/serialize (incl. whitelist logic) | `src/lib/parsers.ts` ( `getSortingStateParser` ) |
| Trip-related search param keys (server cache) | `src/lib/searchparams.ts` |
| Fahrten nav target | `src/config/nav-config.ts` → `Fahrten` → `/dashboard/trips` |
| Trips `Row` types (incl. price fields) | `src/types/database.types.ts` — `public.Tables.trips` |
| Filter bar (URL as source of truth) | `src/features/trips/components/trips-filters-bar.tsx` |
| RSC refresh chrome (does not unmount table) | `src/features/trips/components/trips-rsc-refresh-chrome.tsx` |
| Fahrten sort map + nuqs whitelist (`TRIPS_SORT_MAP`, `TRIPS_SORTABLE_IDS`) | `src/features/trips/trips-sort-map.ts` |

**Docs in `docs/` related to the list / query**

| Document | Relevance |
|----------|------------|
| `docs/trips-date-filter.md` | Explains `scheduled_at` / `requested_date` filter behaviour for the same RSC query as the Fahrten list + Kanban. |
| `docs/kts-architecture.md` | References Fahrten list columns (`columns.tsx`, KTS column). |

**Files explicitly searched, not used as “Fahrten page” table**

- `app/(dashboard)/fahrten/**` — not present. “Fahrten” in the app maps to `src/app/dashboard/trips/`.
- `src/app/dashboard/regelfahrten/page.tsx` — separate **Regelfahrten** feature, out of scope for this list audit.

---

## 2. Data Fetching Summary

### How data is loaded

- **Not React Query** for the main trip rows. The trip list is loaded in the **React Server Component** `TripsListingPage` via **`createClient()` from `@/lib/supabase/server`** and a **PostgREST** query on the **`trips`** table.
- **React Query** is used elsewhere on the page ecosystem (e.g. reference data in filters, `DriverSelectCell` via `useDriversQuery`); the **table body rows** are RSC-fetched props, not `useQuery` data.

### Exact Supabase shape (as written)

- **Table:** `trips`, with:
  - `select('*', … embeds, { count: 'exact' })` — all base columns on `trips` are included via `*`, then embedded relations.
- **Embeds (joins by FK):**
  - `payer:payers(name)`
  - `billing_variant:billing_variants(name, code, billing_types(name, color))`
  - `driver:accounts!trips_driver_id_fkey(name)`
  - `fremdfirma:fremdfirmen(id, name, default_payment_mode)`
  - `invoice_line_items!invoice_line_items_trip_id_fkey(invoice_id, invoices(status, paid_at, sent_at))` (commented in code for invoice status badge)
- **RPC:** The listing may call `resolveInvoiceStatusTripFilter` (and related) **only when** `invoice_status` is one of the fixed filter values; that path can narrow by trip IDs (`in` / `not_in`), not as the main `select` shape.

**Price-related base columns via `*`:**
Because the query uses `*`, any columns on `public.trips` (including `gross_price`, `net_price`, `tax_rate`, `base_net_price`, `approach_fee_net`, `manual_gross_price`, etc. per generated types) are **selected** as long as they exist on the table. They are **not** given dedicated table columns in `columns.tsx` today; at most they appear in derived UI elsewhere (e.g. address helpers only use a subset of fields).

### Server-side sort vs client sort

- **Server-side sort:** Yes. In `TripsListingPage`, `sort` is read from the URL (via `searchParamsCache` + `getSortingStateParser().parseServerSide(...)`), then the Supabase client applies one or more `.order(...)` calls before `.range(...)` in list view.
- **Client-side sort:** With **`manualSorting: true`** in `useDataTable`, TanStack’s `getSortedRowModel` does **not** re-order the page for data semantics: ordering is **delegated to the server**; the current page of rows is only “sorted” in the table state sense for the header indicators.
- **Pagination:** `manualPagination: true` with `page` / `perPage` in the URL. Only the current slice (`range`) is passed to the client. Sorting is **not** “sort this page in memory” as the source of truth — it is **global order in the database**, then paginate.

### React Query and sort state

- There is **no** React `queryKey` for the main trips list: data is RSC. **Implication:** N/A in the “TanStack Query cache per sort” sense. Invalidation/refresh of list data is done via **Next.js RSC refetch** (e.g. `refreshTripsPage()` in trip mutations) and `searchParams` changes, not by bumping a `useQuery` key when `sort` changes.
- The **`sort` parameter in the URL** is the primary cache/dedup “key” for human navigation; changing sort triggers a new server render (with `shallow: false` in `useDataTable` for this table) so the RSC re-runs the Supabase query with the new `order` clauses.

---

## 3. Sort State Analysis

### Where sort state lives

- **Source of truth:** **URL** — nuqs `useQueryState('sort', getSortingStateParser<TData>(columnIds)...) in `useDataTable` (see `SORT_KEY = 'sort'`).
- The **RSC** reads the same logical param through **`searchParamsCache.get('sort')`** (after `await searchParamsCache.parse(searchParams)` in both `page.tsx` and `TripsListingPage`).

### `onSortingChange`

- **Defined in** `src/hooks/use-data-table.ts`: updates the parsed `sort` query state (replace history by default, debounced as configured) when the TanStack table’s sorting state changes.
- `TripsTable` passes `shallow: false`, so sort changes are intended to participate in “real” navigation behaviour (not shallow-only), aligning with RSC re-fetch of `TripsListingPage`.

### Persistence across navigation

- **Persists in the session** as long as the **URL** keeps `?sort=...`. In-app updates go through `nuqs`.
- **Leaving** `/dashboard/trips` **drops** the list’s query string unless the user returns via a link that preserves it.
- There is no separate Zustand/Context store for **sort** (only `useTripsTableStore` for `table` instance and column visibility — not the sort list).

### `useEffect` hooks tied to the table (Trips list component)

`TripsTable` (`trips-tables/index.tsx`):

- Syncs TanStack `table` into `useTripsTableStore` on mount/update and clears on unmount.
- Syncs `columnVisibility` to the same store.
- **None of these** directly modify sort state; they are for bulk actions and external consumers.

`DataTable` (`data-table.tsx`):

- **Scroll-into-view** for `scrollToRowId` when row IDs change; unrelated to sort.

`TripsFiltersBar` has many effects for filters + refresh; **sort** is not owned there (filters and sort are both URL-driven but sort is read in `useDataTable` and `trips-listing`).

### Parser & whitelist mismatch (important)

- `getSortingStateParser` optionally **restricts** valid sort `id` values to a **set built only from `column.id`** on the column definition (`filter(Boolean)`).
- In `columns.tsx`, **`pickup_address` and `dropoff_address` columns have no `id` field** (only `accessorKey`). The whitelist passed from `useDataTable` **therefore does not** include the runtime default ids (`pickup_address` / `dropoff_address` unless added explicitly).
- **Implication:** Sorting on **Abholung** / **Ziel** is **unsound** for URL state: the parser can reject the whole `sort` value, user-visible sort and URL can disagree, and behaviour after reload is **unreliable**.

**Server RSC** calls `getSortingStateParser().parseServerSide(...)` **without** a column-id whitelist, so the server can accept a wider set of `sort` ids than the client parser when `columnIds` is omitted — a **client/server validation asymmetry** for the same `sort` string (see `lib/parsers.ts` vs `trips-listing.tsx`).

---

## 4. Table Configuration

### Library

- **TanStack Table** (`@tanstack/react-table`) v8 style API, via `useReactTable` in `useDataTable`, same version as the rest of the app.

### `manualSorting` and forwarding to the data layer

- **`manualSorting: true`** is set in `useDataTable` (along with `manualPagination: true` and `manualFiltering: true`).
- **Server:** `trips-listing.tsx` maps `sort` rules to `query.order(...)` (including renames, e.g. `name` → `client_name`, `date`/`time` → `scheduled_at`, and foreign table orders for `payer`, `driver`, `billing_variant`).
- **Gap:** The **fallback** branch is `query.order(sortRule.id, { ascending: !isDesc })` for any id not in the special cases. If `sortRule.id` is **not** a real `trips` column (e.g. computed/join-only fields), the query **can error** at runtime (e.g. `invoice_status` is a **column id in the table UI** but **not** a column on `public.trips` in `database.types.ts`).

### `manualPagination` and dataset size

- The **full result set** is not loaded in list view: `range(from, to)` is applied. Kanban uses a high `limit(2000)` and no range — separate mode.

### Column definitions ( Liste — `columns.tsx` )

`enableSorting` is **omitted** on most columns → TanStack default **`true`**, except where noted. No custom `sortingFn` is set in this file. Header labels are as in the `title` passed to `DataTableColumnHeader`.

| `id` / key | Header (DE) | `id` (if explicit) | `accessorKey` / `accessorFn` | `enableSorting` |
|------------|-------------|--------------------|-----------------------------|-----------------|
| Select | (checkbox) | `select` | (implicit for selection) | **false** |
| Datum | `Datum` | `scheduled_at` | `scheduled_at` | default true |
| Zeit | `Zeit` | `time` | `scheduled_at` | default true |
| Fahrgast | `Fahrgast` | `name` | `client_name` | default true |
| Abholung | `Abholung` | *(no `id` — runtime id typically `pickup_address`)* | `pickup_address` | default true |
| Ziel | `Ziel` | *(no `id` — runtime id typically `dropoff_address`)* | `dropoff_address` | default true |
| Fahrer | `Fahrer` | `driver_id` | `driver.name` (nested) | default true |
| Status | `Status` | `status` | `status` | default true |
| Rechnungsstatus | `Rechnungsstatus` | `invoice_status` | *(no accessor — cell uses `invoice_line_items`)* | default true |
| Kostenträger | `Kostenträger` | `payer_name` | `payer.name` | default true |
| Fremdfirma | `Fremdfirma` | `fremdfirma` | `accessorFn` → fremdfirma name string | default true |
| Abrechnung Fremdfirma | `Abrechnung Fremdfirma` | `fremdfirma_abrechnung` | `accessorFn` → `fremdfirma_payment_mode` | default true |
| Abrechnung | `Abrechnung` | `billing_type` | `billing_variant.name` | default true |
| Anrufstation | `Anrufstation` | `billing_calling_station` | `accessorFn` | default true |
| Betreuer | `Betreuer` | `billing_betreuer` | `accessorFn` | default true |
| KTS | `KTS` | `kts_document_applies` | `kts_document_applies` | default true |
| Aktionen | (row actions) | `actions` | – | default (likely non-sorting in practice without accessor) |

**Supabase result includes price fields (via `*`) even if not shown:** Yes — `gross_price`, `net_price`, `tax_rate`, etc. are on `trips.Row` and included in the `select('*', …)`.

---

## 5. Risk Flags

1. **Invalid server ORDER BY for some user-sortable headers**  
   Special cases in `trips-listing.tsx` do not cover every column id. The generic `order(sortRule.id)` can reference **non-existent** or **non-scalar-embedded** names (e.g. **`invoice_status`** is not a `trips` column; **`fremdfirma`** is not a base column and **`fremdfirma_abrechnung`** is not a DB field name). That can **throw** the RSC path (`toQueryError`) and surface as a page error, not a silent wrong order.

2. **Sort URL validation mismatch (whitelist vs RSC, address columns)**  
   - Client: `getSortingStateParser(columnIds)` may **null out** sort when ids are not in the `column.id` whitelist — **Abholung/Ziel** are the clearest case (no `id` in defs).  
   - Server: `getSortingStateParser().parseServerSide` with **no whitelist** accepts the same `sort` string.  
   This can cause **inconsistent** behaviour between what the RSC does and what the client parser will accept, and **unstable** sort state for address columns.

3. **Silent parse failures**  
   In `getSortingStateParser` `parse`, **try/catch returns `null`**; combined with `withDefault` sort, invalid strings **drop** to default without user-visible error — can look like “sort not applied” with no explanation.

4. **Async in cells**  
   `DriverSelectCell` uses `useDriversQuery` and local loading state — **not** async render with suspense per row, but the cell **does** remount/transition loading; this is a **data-fetching** concern, not TanStack re-sort of rows, but it can cause **flicker** when combined with RSC refresh.

5. **Table re-mount on sort**  
   `TripsTable` is not keyed on `sort`; list view should **not** unmount the whole table solely because sort changed. (Kanban uses `kanbanKey` that **does not** include `sort` — a separate concern for Kanban + sort consistency.)

6. **Conditional unmount of the “whole table”**  
   `TripsRscRefreshChrome` only shows a top loading strip; it does **not** unmount the table. View switching (`view === 'kanban'`) swaps Kanban vs table — that is the main **structural** unmount, not sort.

7. **Multi-column `sort` in URL**  
   The RSC does `forEach` on the parsed array; Supabase/PostgREST will apply multiple `.order` calls. Whether the backend composes a stable multi-key order is an **integration detail** worth verifying for complex sorts; not inspected beyond static read.

8. **Optional chaining masking bad data**  
   Many cells use `?.` for embedded objects (e.g. `payer?.name`); that **hides** missing embeds in the UI but does **not** by itself break sort. Sort break risk is more from **order column mapping** and **URL parser** (above).

---

## 6. Schema / Field Availability

**From** `src/types/database.types.ts` — `public.Tables.trips.Row` (abridged to price-related and list-relevant fields):

| Column (DB) | Type (in types) |
|-------------|-----------------|
| `gross_price` | `number \| null` |
| `tax_rate` | `number \| null` |
| `base_net_price` | `number \| null` |
| `approach_fee_net` | `number \| null` |
| `manual_gross_price` | `number \| null` |
| `net_price` | `number` (documented in types as **generated** combined net) |
| `selbstzahler_collected_amount` | `number \| null` |
| `kts_document_applies` | `boolean` |
| `fremdfirma_id` / `fremdfirma_payment_mode` / `fremdfirma_cost` | as per `Row` |
| *No* `invoice_status` on `trips` | — (invoice state comes from `invoice_line_items` + `invoices` embed) |

**Conclusion:** `gross_price`, `net_price`, and `tax_rate` **exist** on the `trips` table in generated types. The Fahrten list **selects** them through `*`. The **table component does not** expose them as sortable columns in `columns.tsx` by default, but the **data** is on each row in memory.

---

## 7. Senior Recommendation

**Overall quality:** The architecture is a **sensible** split: **RSC for filtered + ordered + paginated** trip rows, **nuqs** for **shareable and restorable** list state, and **TanStack** for selection, display, and header UX. That is appropriate for a server-authoritative list.

**The weak points are** (1) **mapping from UI column ids to `ORDER BY` columns / embeds** is incomplete and can **break the page** for otherwise “normal” header sorts, and (2) **the sort parser whitelist** (based only on explicit `column.id` values) is **inconsistent** with the RSC parser and with columns that rely on **`accessorKey`-only** ids — causing **dropped** or **non-round-trippable** sort state for at least the address columns.

**Highest-priority fixes before adding new columns**

1. **Unify and harden the sort contract:** One shared module that defines **(a)** which columns are user-sortable, **(b)** the **exact** PostgREST/Supabase `order` mapping (including join/fallback), and **(c)** the same id whitelist for **client + RSC** parsers. For non-sortable or computed columns (e.g. invoice status from nested embeds), **set `enableSorting: false`** or implement a documented RPC/view-backed sort.
2. **Add explicit `id` to every sortable column** (or add `pickup_address` / `dropoff_address` to the parser whitelist) so **nuqs** validation matches TanStack’s runtime column ids, and keep **server and client** parsers in lockstep.
3. **Add defensive UX or tests** for the generic `order(sortRule.id)` path — either **remove** the fallback, or **map** it through a **strict** allowlist of real `trips` column names; treat anything derived from relations as an explicit case to avoid RSC 500s when users (or support) paste a `sort=` URL.

After these, adding new list columns (including price) is mostly: extend **types**, **RSC `order` mapping**, **optional column def**, and **nuqs** allowlist in one go — without reintroducing a **split-brain** between URL, TanStack, and PostgREST.
