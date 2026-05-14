# Audit — Trips filter bar: existing filter types and extension pattern

Read-only audit. Sources: [`trips-filters-bar.tsx`](../../src/features/trips/components/trips-filters-bar.tsx), [`searchparams.ts`](../../src/lib/searchparams.ts), [`trips-listing.tsx`](../../src/features/trips/components/trips-listing.tsx) (query section), [`trips.ts` (query keys)](../../src/query/keys/trips.ts).

---

## 1. Filter state shape

### Exact TypeScript shape

There is **no** dedicated exported interface (e.g. `TripsFilterState`). Filters are modeled as **URL search parameters** validated by **nuqs** on the server.

The canonical parser object is in `src/lib/searchparams.ts` **L8–L25**:

```ts
export const searchParams = {
  page: parseAsInteger.withDefault(1),
  perPage: parseAsInteger.withDefault(50),
  search: parseAsString,
  name: parseAsString,
  gender: parseAsString,
  category: parseAsString,
  // trip filters
  status: parseAsString,
  driver_id: parseAsString,
  payer_id: parseAsString,
  billing_variant_id: parseAsString,
  invoice_status: parseAsString,
  scheduled_at: parseAsString,
  sort: parseAsString,
  view: parseAsString.withDefault('list')
};
```

Trips listing reads these via `searchParamsCache` after `parse(searchParams)` in [`trips-listing.tsx`](../../src/features/trips/components/trips-listing.tsx) **L46–L59** (individual `get()` calls).

The filter bar **mirrors** the URL with `useSearchParams()` in [`trips-filters-bar.tsx`](../../src/features/trips/components/trips-filters-bar.tsx) **L74–L81**, applying string defaults such as `'all'` for several keys where the URL omits the param.

### How state is stored

| Layer | Mechanism |
|--------|-----------|
| **Source of truth** | **URL query string** (`nuqs` parsers + `createSearchParamsCache` on RSC; `useSearchParams` + `router.replace` on client). Documented explicitly in `trips-filters-bar.tsx` **L4–L6**. |
| **Ephemeral UI** | `useState` for **local search** debounce input (**L100–L106**), **`filtersExpanded`** collapsible (**L131**), and **`useTransition`** for navigation (**L69**). |
| **Table chrome** | **Zustand** `useTripsTableStore` for **`table`** and **`columnVisibility`** (**L84–L87**) — affects which filters are shown (e.g. `invoice_status`), **not** the Supabase trip query payload. |

**Not used** for list filters: a dedicated `use-trips-filters.ts` does **not** exist; React Query keys under `tripKeys` are **not** how the main Fahrten grid load is keyed (see §3).

### Reset filters

**Yes.** Ghost icon button **“Filter zurücksetzen”** in [`trips-filters-bar.tsx`](../../src/features/trips/components/trips-filters-bar.tsx) **L450–L470** calls `updateFilters` with **all** of these keys set to `null` (removes from URL):

- `search`
- `driver_id`
- `status`
- `payer_id`
- `scheduled_at`
- `billing_variant_id`
- `invoice_status`

`updateFilters` also forces **`page` → `1`** (**L227**). It does **not** clear `view`, `perPage`, or `sort` in that reset payload.

---

## 2. Existing filter types

| Filter | URL param | UI (filter bar) | Supabase / RPC application (RSC) |
|--------|-----------|-----------------|----------------------------------|
| **Date / range** | `scheduled_at` | `DateRangePicker` (**L329–L336**, **L237–L246**); parses URL in **L163–L183** | [`trips-listing.tsx`](../../src/features/trips/components/trips-listing.tsx) **L166–L235** — `.or(...)` on `scheduled_at` + `requested_date`; see comment block **L152–L165**. |
| **Text search** | `search` | `Input`, debounced 350 ms (**L249–L255**, narrow **L481–L486**, wide **L534–L538**) | **L146–L150** — `.or(` `client_name` / `pickup_address` / `dropoff_address` `.ilike`). |
| **Driver** | `driver_id` | `Select` (`all` / `unassigned` / driver ids) (**L340–L360**) | **L121–L126** — `.eq` or `.is('driver_id', null)`. |
| **Status** | `status` | `Select` (**L362–L382**) | **L114–L119** — `.eq` or `.in` for comma-separated values. |
| **Payer** | `payer_id` | `Select` (**L384–L407**); clears `billing_variant_id` when payer changes (**L388–L390**) | **L128–L129** — `.eq('payer_id', payerId)`. |
| **Billing variant** | `billing_variant_id` | `Select`, only if payer ≠ `all` and variants exist (**L409–L441**) | **L131–L133** — `.eq('billing_variant_id', ...)`. |
| **Invoice status** | `invoice_status` | `Select` (**L257–L279**, wired when column visible **L86–L87**) | **L63–L75** + **L134–L145** — `resolveInvoiceStatusTripFilter` (RPC) → `.in('id', ...)` or `.not('id', 'in', ...)`; empty `in` skips query (**L77–L78**). |

### Boolean / toggle filter for **rows**

**None** in the filter bar. All trip filters are **string-valued URL params** rendered as **Select**, **Input**, or **date picker**.

### Closest “toggle-like” UI

- **`Collapsible`** “Weitere Filter” on narrow view (**L478–L527**) — layout, not a data filter.
- **Spalten visibility** (`Popover` + `Command` + `CommandItem` **L281–L327**) toggles **column visibility** in TanStack Table, not PostgREST filters.

---

## 3. How filters reach the query

### URL → RSC (not client `useQuery` for the grid)

1. **User changes a control** in `TripsFiltersBar` → `updateFilters` (**L216–L234**) builds `URLSearchParams`, sets **`page=1`**, then **`router.replace(next, { scroll: false })`** and **`void refreshTripsPage()`** (**L230–L233**).
2. **Next.js** loads the trips route with the new search string; **`TripsListingPage`** runs as an **RSC** and calls **`await searchParamsCache.parse(searchParams)`** (**L46**).
3. **Listing** reads **`status`**, **`driverId`**, **`payerId`**, **`billingVariantId`**, **`search`**, **`scheduledAt`**, **`invoiceStatus`** from the cache (**L52–L59**) and applies them to **`supabase.from('trips').select(...)`** (**L108–L111** and forward).

So: filters are **not** passed into a client-side `useQuery` keyed by `tripKeys` for the paginated list. **`tripKeys`** (see [`trips.ts`](../../src/query/keys/trips.ts)) covers **detail**, **dashboard aggregates**, **unplanned**, **invoiceStatuses**, **presets**, etc. — **not** the RSC list query shape.

### Code path summary

`TripsFiltersBar.updateFilters` → `router.replace` + `refreshTripsPage` → **RSC** `TripsListingPage` → **`searchParamsCache`** → **Supabase query** chain starting at **L113** in [`trips-listing.tsx`](../../src/features/trips/components/trips-listing.tsx).

---

## 4. Filter bar UI pattern

### Component library

- **shadcn / Radix**: `Button`, `Input`, `Select`, `Popover`, `Command`, `Collapsible` (see imports **L25–L52** in `trips-filters-bar.tsx`).
- **Date range**: shared **`DateRangePicker`** from `@/components/ui/date-time-picker` (**L47**, **L329–L336**).

### “Filter chip” / active badge pattern

**Not present** for individual filters. The bar shows **`{totalItems} Fahrten`** (**L447–L448**) and a **reset** icon (**L450–L470**). “Advanced” vs default is tracked internally via **`hasAdvancedFilters`** (**L133–L141**) to auto-expand the collapsible section (**L143–L160**), not as chips.

### Overflow / collapse

- **Below `md` (768px)** (`useIsNarrowScreen` **L72**): **primary row** = search + date + **CollapsibleTrigger** (“Weitere Filter”) (**L476–L505**). **Advanced** selects + invoice + Spalten sit in **`CollapsibleContent`** (**L507–L526**).
- **`md` and up** (**L531–L556**): **single horizontal row** with **`md:overflow-x-auto`** on the main flex container (**L533**) so controls can scroll horizontally rather than a second collapsible for “more filters”.

Approximate **always-visible** controls on wide layout: search, date, invoice status (if column visible), Spalten popover, then **driver / status / payer / (optional) billing** in a grid that becomes **`md:contents`** (**L549–L551**) — i.e. **many** controls in one scrollable row; there is no fixed “N filters then +More” cap beyond responsive layout.

---

## 5. Extension pattern (for future work)

To add a filter (e.g. KTS / boolean):

1. **Add a `parseAs*` entry** to `searchParams` in [`src/lib/searchparams.ts`](../../src/lib/searchparams.ts) if the value should be URL-backed like existing filters.
2. **Read it** in [`trips-listing.tsx`](../../src/features/trips/components/trips-listing.tsx) from `searchParamsCache` and **apply** `.eq` / `.is` / etc. on the Supabase builder next to **L113–L151**.
3. **Drive the UI** from **`useSearchParams`** and **`updateFilters`** in [`trips-filters-bar.tsx`](../../src/features/trips/components/trips-filters-bar.tsx); include the key in **reset** (**L458–L466**) if it should clear with “Filter zurücksetzen”.
4. Optionally extend **`kanbanKey`** in `trips-listing.tsx` (**L282–L291**) if Kanban should remount when the new param changes.

`tripKeys` changes are **only** needed if new client queries should invalidate together with trips — **not** required for RSC list filtering by URL alone.
