# AUDIT — Fahrten: Preset feasibility + performance

**Scope:** Read-only codebase review (`/dashboard/trips`). No application code changes as part of this audit.

**Primary sources reviewed:**  
`page.tsx`, `fahrten-page-shell.tsx`, `trips-listing.tsx`, `searchparams.ts`, `trips-view-toggle.tsx`, `trips-filters-bar.tsx`, `use-trip-form-data.ts`, `use-trip-reference-queries.ts`, `trips-realtime-sync.tsx`, `trips-rsc-refresh-provider.tsx`, `trips.service.ts`, `tripKeys` (`src/query/keys/trips.ts`), `reference.ts`, `use-data-table.ts`, `trips-tables/index.tsx`, `resolve-invoice-status-trip-filter.ts`, `trips-sort-map.ts`, migrations (trips indexes + preset-related grep).

---

## Section A — Preset system feasibility

### A.1 Current filter state

#### URL search params (Fahrten-relevant)

| Key | Defined in `searchParams` (`src/lib/searchparams.ts`) | Parser / default | Written/read by listing + filter bar |
| --- | --- | --- | --- |
| `page` | yes | `parseAsInteger.withDefault(1)` | Pagination (`useDataTable` in `TripsTable`) |
| `perPage` | yes | `parseAsInteger.withDefault(50)` | Pagination |
| `search` | yes | optional string (`parseAsString`, no default in schema) | Free-text filter (debounced in bar → URL) |
| `status` | yes | optional string | Select; bar removes key for “all”; listing supports **`status` with commas** (`status.split(',')`) for multi-status URLs |
| `driver_id` | yes | optional string | `all` / `unassigned` / UUID sentinels in bar |
| `payer_id` | yes | optional string | `all` or UUID |
| `billing_variant_id` | yes | optional string | `all` or UUID (cleared when payer changes) |
| `invoice_status` | yes | optional string | `all` \| `uninvoiced` \| `draft` \| `sent` \| `paid` (see listing) |
| `scheduled_at` | yes | optional string | **Range:** `"fromMs,toMs"` (timestamps); **single day:** YMD `yyyy-mm-dd` or single numeric timestamp — see `trips-listing.tsx` vs bar `selectedDateRange` |
| `sort` | yes | optional string | Parsed by `getSortingStateParser(TRIPS_SORTABLE_IDS)` — compact `id.asc`/`id.desc` or JSON array format |
| `view` | yes | `parseAsString.withDefault('list')` | `list` \| `kanban` (`trips-view-toggle.tsx`) |

**Also in global `searchParams` but not wired on Fahrten listing/bar:** `name`, `gender`, `category` (used elsewhere / shared nuqs module).

**Defaults not in URL until mount:** `TripsFiltersBar` runs a **one-time** `useEffect` (empty deps): if `scheduled_at` is missing, it **`router.replace`** adds `scheduled_at=todayYmdInBusinessTz()` and `page=1`. So “today” is not only a parser default — it is **injected on first load**.

#### Is all filter state in the URL?

**Mostly yes** for the filter bar fields above (status, driver, payer, billing variant, invoice status, date range, search, view, pagination, sort).

**Not URL-serialized (lost on full navigation / new tab without extra work):**

- **Column visibility** for the data table: `useTripsTableStore` (Zustand) mirrors TanStack `columnVisibility`, but `useDataTable` holds visibility in **React `useState`**, not nuqs — **not in URL**, not persisted across hard reloads.
- **Collapsible “more filters” open/closed** (`filtersExpanded`) — local `useState` only.
- **Local search input** before debounce completes — transient until 350 ms fires.

#### Arrays / objects in the URL today

- **No multi-select payer IDs** in the UI: payer is a **single** `Select` → one UUID string or omitted/`all`.
- **Date range:** two epoch ms joined by comma in `scheduled_at`.
- **`status`:** logically multi-capable (`comma` split in RSC); bar sets a single scalar or clears.
- **`sort`:** multiple rules via comma-separated tokens or JSON (see `getSortingStateParser` in `src/lib/parsers.ts`).

### A.2 View state

- **`view=list|kanban`:** URL-driven (`view` query param); toggle uses `router.push(pathname + '?' + …)` sets **`view=list`** or **`view=kanban`**, then `refreshTripsPage()`.
- **Sort:** URL-driven via `sort` + `useDataTable` (`shallow: false` on trips table → full URL coordination).
- **Pagination:** URL `page`, `perPage`.
- **Column visibility:** **not URL-driven**; **configurable** via “Spalten” popover in `TripsFiltersBar` when `currentView === 'list'` — toggles TanStack visibility; wired through `useTripsTableStore` for the popover listing; initial hidden columns in `TripsTable`: `net_price`, `tax_rate`.

### A.3 Preset system fit assessment

- **URL snapshot presets:** Architecture is favorable: listing is **server-driven from `searchParamsCache`**, filter bar explicitly documents **URL as source of truth**. A preset = stored string of query params or a deserialize/serialize round-trip through the same keys.
- **Existing infrastructure:**
  - **No** DB table named `presets`, `saved_views`, `saved_view`, `user_preferences` found in **`supabase/migrations`** (grep).
  - **No** Fahrten-specific `use-saved-filters`-style hook; no localStorage coupling for trips filters in reviewed files.
  - **Analogous concepts elsewhere:** Angebote **column presets** (`angebot-column-presets.ts`, plans/docs only in this repo audit); **DateRangePicker** “preset shortcuts” (`date-time-picker.tsx` — UI presets, not saved user views); invoice builder date presets; overview pie “time preset” — **none of these reuse Fahrten URL state**.
- **Count of meaningful filter dimensions (for presets value):** **10** — `scheduled_at`, `search`, `status`, `driver_id`, `payer_id`, `billing_variant_id`, `invoice_status`, `view`, `sort`, `page/perPage` (count as pagination pair). Optional extension: persist **column visibility** if presets should include layout.

### A.4 UI placement + DB persistence

**Layout (inside listing):**

- **`PageContainer`** title “Fahrten” + **`TripsPageHeaderActions`** (Print, CSV, Bulk upload) on the right — **no filter row there**.
- **Below:** flex row (md+): **`TripsViewToggle`** (Liste/Kanban) + **`TripsFiltersBar`** (`flex-1`) with search, date range, Spalten, advanced selects, count + reset.
- **Preset selector** could sit: (1) left of or inside the filter bar row, (2) in `pageHeaderAction` next to print/CSV, or (3) as a compact dropdown above the bar. No dedicated slot exists today; filter bar is the densest natural home.

**DB:** No `presets` / `user_preferences` / `saved_views` migrations found.

---

## Section B — Performance investigation

### B.1 Main trips list — what is fetched?

**Location:** `src/features/trips/components/trips-listing.tsx` (RSC), `createClient()` server Supabase.

**Exact `.select()` string (template literal as in source):**

```text
    *,
    payer:payers(name),
    billing_variant:billing_variants(name, code, billing_types(name, color)),
    driver:accounts!trips_driver_id_fkey(name),
    fremdfirma:fremdfirmen(id, name, default_payment_mode),
    invoice_line_items!invoice_line_items_trip_id_fkey(
      invoice_id,
      invoices(status, paid_at, sent_at)
    ) // For trip invoice status badge — only trip_id-linked line items; manual lines (trip_id IS NULL) are excluded by the FK join
```

**Joins / embeds (logical PostgREST resource graph):**

| Relationship | Selected columns |
| --- | --- |
| `trips` | `*` (all base columns) |
| `payers` (alias `payer`) | `name` |
| `billing_variants` (alias `billing_variant`) | `name`, `code`; nested `billing_types`: `name`, `color` |
| `accounts` FK `trips_driver_id_fkey` (alias `driver`) | `name` |
| `fremdfirmen` (alias `fremdfirma`) | `id`, `name`, `default_payment_mode` |
| `invoice_line_items` FK `invoice_line_items_trip_id_fkey` | `invoice_id`; nested `invoices`: `status`, `paid_at`, `sent_at` |

**Pre-query (invoice filter):** If `invoice_status` is set to an effective category, **`resolveInvoiceStatusTripFilter`** runs **before** the list query:

- Preferred: **`rpc('trip_ids_matching_invoice_effective_status', { p_effective })`** → `{ kind: 'in', tripIds }`.
- Fallback if RPC missing: **`buildInvoiceStatusTripFilterFallback`** — paginated full scan of **`invoice_line_items`** (`trip_id NOT NULL`), 1000 rows per page until exhaustion, aggregates by trip — **worst-case very expensive**.

**Special cases:**

- **`skipTripsQuery`:** RPC returned `in` with **empty** `tripIds` → listing returns **no DB list call** (`trips = []`).
- **`view === 'kanban'`:** `.limit(2000)` — up to **2000 rows** with full embed payload.
- **List view:** `.range(from, to)` pagination from `page` / `perPage`.

**N+1:** Main list is **single round-trip**. **Driver cells** use **`useDriversQuery()`** once per page (shared TanStack cache, not per row network). Mutation path uses Supabase client on driver change — not part of initial list load.

### B.2 Query triggering — refetch model

**Main grid data:** **RSC**, not `useQuery` for the trip rows. **`TripsListingPage`** is async server component; Supabase runs on server per navigation/revalidation.

**`refreshTripsPage()`** (`trips-rsc-refresh-provider.tsx`): **`await router.refresh()`** then **`queryClient.invalidateQueries({ queryKey: tripKeys.all })`**. Liste/Kanban body is **not** TanStack-fetch-based; **`tripKeys`** cover **detail / unplanned / timeless** caches, **not** the main grid.

**Causes refetch / RSC re-execution:**

- Any navigation or **`router.refresh()`** after filter **`router.replace`** from bar / table (`TripsFiltersBar.updateFilters`, view toggle, `useDataTable` with `shallow: false`).
- **`TripsRealtimeSync`:** Supabase channel **`trips-realtime-sync`** on **`INSERT`** and **`UPDATE`** `public.trips` → debounced **`refreshTripsPage()`** (**450 ms** debounce).
- Manual refresh patterns calling **`refreshTripsPage`** (e.g. after mutations from same page).

**TanStack `staleTime` (reference lists only, not main list):**  
`TRIP_REFERENCE_STALE_TIME_MS = 10 * 60 * 1000` (**10 minutes**) for drivers, payers, billing variants (`use-trip-reference-queries.ts`). **`gcTime`** not overridden → React Query default.

**Window focus:** No `refetchOnWindowFocus` customization found on these reference queries (library defaults apply).

### B.3 Indexes on `public.trips` (from `supabase/migrations`)

**`CREATE INDEX` statements targeting `public.trips` found:**

| Migration | Index name | Column(s) |
| --- | --- | --- |
| `20260326120000_billing_families_and_variants.sql` | `trips_billing_variant_id_idx` | `billing_variant_id` |
| `20260404103000_no_invoice_fremdfirma_recurring.sql` | `idx_trips_fremdfirma_id` | `fremdfirma_id` |
| `20260418120000_trips-price-schema.sql` | `idx_trips_billing_type_id` | `billing_type_id` |

**Not found in migrations (for this repo):** explicit index on **`company_id`**, **`driver_id`**, **`status`**, **`scheduled_at`**, **`requested_date`**, or composite `(company_id, scheduled_at)` / date helpers.

*Note:* Production DB may have indexes created outside these files; this audit only reflects **checked-in migrations**.

### B.4 Filter change path + reference data

**Filter change (e.g. payer):**

1. Client updates URL via **`router.replace`** + **`startTransition`**.
2. **`refreshTripsPage()`** is always called with filter updates (bar comment: avoid stale RSC tree).
3. That triggers **server RSC re-run** + full **`TripsListingPage`** Supabase query — **not** a client-side React Query refetch for rows.

**Debouncing:**

- **Search input:** **350 ms** debounce before `updateFilters` (`TripsFiltersBar`).
- **Realtime → refresh:** **450 ms** debounce (`TripsRealtimeSync`).

**Reference lists (payers, drivers, billing variants):** **Separate** TanStack queries (`usePayersQuery`, `useDriversQuery`, `useBillingVariantsForPayerQuery`). **Do not refetch on every arbitrary filter change:** queries keyed by stable `referenceKeys`; **`staleTime` 10 min**. Billing variants query **disabled** until payer is a real UUID (not `'all'`).

### B.5 Suspense and loading states

**`page.tsx`:** Wraps **`TripsListingPage`** in **`<Suspense>`** with **`DataTableSkeleton`** (11 cols, 10 rows, 3 filters).

**During `refreshTripsPage`:** **`TripsRscRefreshChrome`** shows a **thin top pulse bar** + `aria-busy`; it **does not** swap the grid for a skeleton.

**Sequential / waterfall:**

1. **`resolveInvoiceStatusTripFilter`** may run **before** trips query (same RSC render path).
2. Listing then runs **trips** select (and count).

No second server round-trip based on trip **results** inside the same file (beyond the conditional skip).

---

## Section C — Senior recommendations

### Presets

- **Feasibility:** **High.** Filters and view/sort/pagination already live in the URL; a preset is a **named saved query string** (or canonical object deserialized to these keys). Minimal implementation: **dropdown** applies `router.replace`/`push` with stored params (+ optional **`refreshTripsPage`** for parity).
- **Storage recommendation:** Start with **server-side presets** keyed by **`company_id` + user** (future Clerk user id / staff profile) when you want **shared named views** (“Dialyse heute”). Use **localStorage** only for quick personal bookmarks if you intentionally avoid migrations — weaker for multi-device and auditing. Hybrid: defaults local, promoted views in DB.

**UI recommendation:** Implement the **preset control on Fahrten** first (toolbar row next to Liste/Kanban or inside filter bar); a separate **“Ansichten verwalten”** page pays off once you need **sharing, ordering, ACL, or descriptions**.

### Performance — likely causes of slow loads (e.g. ~10 s symptom)

Plural causes can stack:

1. **Heavy select:** `trips.*` plus **multiple embeds**, especially **`invoice_line_items` + `invoices`** per trip — payload size + join cost grows with matched rows (Kanban capped at **2000** worst case).
2. **Invoice-status path:** Fallback **full scan/pagination of `invoice_line_items`** before listing if RPC unavailable — dominates wall time.
3. **Indexing gap:** Filters use **`scheduled_at`**, **`requested_date`**, **`company_id`** (via RLS), **`payer_id`**, **`driver_id`**, **`status`** — **`CREATE INDEX`** coverage for these combos is **not evident** in migrations (only billing variant/type/fremdfirma). Poor plans → large sequential scans under RLS.
4. **`ilike` text search** on three columns (`client_name`, pickup, dropoff) without supporting indexes — expensive on wide result sets.

### Top 3 fixes (impact vs effort)

1. **Verify DB indexes in live DB** matching common predicates: **`(company_id, scheduled_at)`**, **`(company_id, requested_date)`**, **`(company_id, driver_id)`**, **`(company_id, payer_id)`**, **`(company_id, status)`** — pick top 2–3 composites by real query plans. **Effort:** low–medium migrations; **impact:** often **large** if table is big.
2. **Ensure `trip_ids_matching_invoice_effective_status` RPC is always deployed** and monitor fallback path — remove/alert on PGRST202 fallback. **Effort:** low ops; **impact:** **very high** when fallback was active.
3. **Reduce payload / split concerns:** e.g. drop or lazy-load **`invoice_line_items` embed** for list (compute badge via single RPC or slimmer join); or cap Kanban lower than 2000 with UX copy. **Effort:** medium refactor; **impact:** high for bytes + serialization.

### Missing indexes (likely immediate win if absent in production)

- **Composite with `company_id`** aligned to default sort/filter: e.g. **`(company_id, scheduled_at DESC NULLS LAST)`** and/or **`(company_id, requested_date)`** for the unscheduled branch of date filters.
- **`driver_id`**, **`payer_id`**, **`status`** under **`company_id`** if selective filters are common.

---

*End of audit.*
