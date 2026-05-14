# Audit — Fahrten header actions + column visibility state

Read-only audit (2026-05-14). Scope: `/dashboard/trips` shell, header toolbar, filters bar “Spalten”, trips table store, and URL search params.

---

## 1. Header actions component

### Component name and file path

- **`TripsPageHeaderActions`** — [`src/app/dashboard/trips/trips-header-actions.tsx`](../../src/app/dashboard/trips/trips-header-actions.tsx)

It composes three **client-only** controls (each loaded via `next/dynamic` with `ssr: false`):

- `PrintTripsButton` from [`src/features/trips/components/print-trips-button`](../../src/features/trips/components/print-trips-button.tsx) (path as in source)
- `DownloadCsvButton` from [`src/features/trips/components/csv-export/download-csv-button`](../../src/features/trips/components/csv-export/download-csv-button.tsx)
- `BulkUploadDialog` from [`src/features/trips/components/bulk-upload-dialog`](../../src/features/trips/components/bulk-upload-dialog.tsx)

### How it is composed into the page (exact JSX)

1. **Route** [`src/app/dashboard/trips/page.tsx`](../../src/app/dashboard/trips/page.tsx):

```tsx
<FahrtenPageShell>
  <PageContainer
    scrollable={false}
    pageTitle='Fahrten'
    pageDescription='Alle Fahrten auf einen Blick verwalten.'
    pageHeaderAction={<TripsPageHeaderActions />}
  >
    <Suspense fallback={...}>
      <TripsListingPage searchParams={props.searchParams} />
    </Suspense>
    <TripsRealtimeSync />
  </PageContainer>
</FahrtenPageShell>
```

2. **`FahrtenPageShell`** ([`fahrten-page-shell.tsx`](../../src/app/dashboard/trips/fahrten-page-shell.tsx)) only wraps children with `TripsRscRefreshProvider` — **no** header slot; the header action is entirely the **`pageHeaderAction` prop on `PageContainer`**.

3. **`PageContainer`** ([`src/components/layout/page-container.tsx`](../../src/components/layout/page-container.tsx)) renders `pageHeaderAction` beside the `Heading` in a flex row:

```tsx
{pageHeaderAction && (
  <div className='flex shrink-0 flex-nowrap items-center justify-end gap-2 overflow-x-auto'>
    {pageHeaderAction}
  </div>
)}
```

4. **`TripsPageHeaderActions`** body:

```tsx
export function TripsPageHeaderActions() {
  return (
    <div className='flex shrink-0 flex-nowrap items-center justify-end gap-2'>
      <PrintTripsButton />
      <DownloadCsvButton />
      <BulkUploadDialog />
    </div>
  );
}
```

### Props today

- **`TripsPageHeaderActions`**: **no props** — signature is `export function TripsPageHeaderActions()` with no parameters.
- It does **not** receive trip rows, filter state, or URL state from the page. Any data those buttons need must come from their own hooks, context, or user-driven flows inside their implementations (not audited here).

---

## 2. Column visibility — current state shape

### Zustand store shape (`useTripsTableStore`)

File: [`src/features/trips/stores/use-trips-table-store.ts`](../../src/features/trips/stores/use-trips-table-store.ts)

| Key / field             | Type |
|-------------------------|------|
| `table`                 | `Table<any> \| null` (TanStack React Table instance) |
| `columnVisibility`      | `VisibilityState` from `@tanstack/react-table` — i.e. **`Record<string, boolean>`** (column id → visible when `true`; omitted keys use TanStack defaults) |
| `setTable`              | `(table: Table<any> \| null) => void` |
| `setColumnVisibility`   | `(visibility: VisibilityState) => void` |

Initial Zustand state: `table: null`, `columnVisibility: {}`.

**Important:** The **live** column visibility that drives rendering comes from the **`Table` instance** created in [`TripsTable`](../../src/features/trips/components/trips-tables/index.tsx). That component syncs TanStack → Zustand on every `table.getState().columnVisibility` change:

```tsx
const columnVisibility = table.getState().columnVisibility;
React.useEffect(() => {
  setColumnVisibility(columnVisibility);
}, [columnVisibility, setColumnVisibility]);
```

So Zustand’s `columnVisibility` is a **mirror** for consumers (e.g. filters bar). **Mutating only Zustand without updating the `Table` would be overwritten** by this effect on the next table state update.

### Trips table column ids (from `columns.tsx`)

File: [`src/features/trips/components/trips-tables/columns.tsx`](../../src/features/trips/components/trips-tables/columns.tsx). Every column `id`:

| Column id | Notes |
|-----------|--------|
| `select` | `enableHiding: false` |
| `scheduled_at` | |
| `time` | |
| `name` | |
| `pickup_address` | |
| `dropoff_address` | |
| `driver_id` | |
| `status` | |
| `gross_price` | |
| `invoice_status` | |
| `payer_name` | |
| `fremdfirma` | |
| `fremdfirma_abrechnung` | |
| `billing_type` | |
| `billing_calling_station` | |
| `billing_betreuer` | |
| `kts_document_applies` | |
| `kts_fehler` | |
| `kts_fehler_beschreibung` | |
| `net_price` | Default **hidden** via `initialState` in `TripsTable` (`false`) |
| `tax_rate` | Default **hidden** via `initialState` (`false`) |
| `actions` | `enableHiding: false` |

### How “Spalten” reads and writes visibility

File: [`src/features/trips/components/trips-filters-bar.tsx`](../../src/features/trips/components/trips-filters-bar.tsx).

**Read path**

- `const table = useTripsTableStore((s) => s.table);`
- `const columnVisibility = useTripsTableStore((s) => s.columnVisibility);` (used in `useMemo` deps to force refresh when visibility changes)
- `hidableColumns`: `table.getAllColumns().filter((col) => typeof col.accessorFn !== 'undefined' && col.getCanHide())`
- Popover only renders when `currentView === 'list' && table` (so **Kanban**: no Spalten; **table not mounted**: no popover).

**Write path**

- Not via Zustand setters. Each `CommandItem` calls **`column.toggleVisibility(!column.getIsVisible())`** — i.e. **TanStack Column API**, which updates internal table state and then flows into Zustand via the sync effect in `TripsTable`.

### Initialization / persistence

- **URL / `searchparams`:** [`src/lib/searchparams.ts`](../../src/lib/searchparams.ts) defines trip-related keys (`page`, `perPage`, `search`, `status`, `driver_id`, `payer_id`, `billing_variant_id`, `invoice_status`, `scheduled_at`, `sort`, `view`, etc.). **There is no `columnVisibility` (or similar) in the URL schema.**
- **`TripsTable` / `useDataTable`:** `initialState.columnVisibility` is **hardcoded**:

```tsx
initialState: {
  columnVisibility: {
    net_price: false,
    tax_rate: false
  }
}
```

- **localStorage / DB:** **No** persistence for trips **list** column visibility in the audited paths. Zustand store is **not** using `persist` middleware for `useTripsTableStore`.

---

## 3. Serialization feasibility

### Can `columnVisibility` be JSON-serialized cleanly?

**Yes.** `VisibilityState` is `Record<string, boolean>` — plain data, no functions, no circular references. Suitable for JSON, URL encoding (if size allows), or DB storage as JSON.

Caveat: keys must stay aligned with **column `id`s** in `columns.tsx`; renames or removed columns require migration or tolerant merging when applying a preset.

### Existing patterns: Zustand + persist / storage

Trips-related examples (not the list table store):

- [`src/features/trips/stores/use-kanban-pending-store.ts`](../../src/features/trips/stores/use-kanban-pending-store.ts) — `zustand` **`persist`** + `localStorageAdapter` from [`src/lib/kanban-local-storage.ts`](../../src/lib/kanban-local-storage.ts) (`createJSONStorage`).
- [`src/features/trips/stores/use-bulk-upload-resume-store.ts`](../../src/features/trips/stores/use-bulk-upload-resume-store.ts) — **`persist`** middleware.

Other: [`src/hooks/use-breadcrumb-store.ts`](../../src/hooks/use-breadcrumb-store.ts) uses `zustand` (audit did not open file; pattern exists in repo).

**No** audited usage of persisting `useTripsTableStore` to localStorage or DB.

---

## 4. Preset injection point (URL + Zustand together)

### What must happen for a preset

1. **URL:** Replace/update query params (filters, `view`, etc.) — today primarily via `router.replace` + `URLSearchParams` in `TripsFiltersBar.updateFilters`, and nuqs-backed state in table pagination/sort where applicable.
2. **Column visibility:** Must update the **TanStack `Table`** (e.g. `table.setColumnVisibility(...)` or per-column toggles), not only Zustand’s mirror — because Zustand is synced **from** the table.

### Is there a single coordinator today?

**No.** As composed in [`page.tsx`](../../src/app/dashboard/trips/page.tsx) and [`trips-listing.tsx`](../../src/features/trips/components/trips-listing.tsx):

- **URL** is driven from **`TripsFiltersBar`** (client) and read by **`TripsListingPage`** (RSC).
- **Table / column visibility** is owned by **`TripsTable`** (client), which registers the table instance into **`useTripsTableStore`**.

`TripsFiltersBar` and `TripsTable` are **siblings** under the listing layout — there is **no** shared parent component that owns both flows today.

Shared **cross-cutting** mechanism: **`useTripsTableStore`** exposes `table` so any client code (including a future “preset” button) could call methods on the same instance **if** `table !== null` (list view mounted).

**Ordering gotcha:** If a preset switches **`view`** from `kanban` → `list`, **`TripsTable` may mount after** the URL update; the table ref is **null** until mount. Column visibility application may need to be **deferred** until `table` is available (e.g. queue in store + `useEffect` in `TripsTable`, or apply in the same tick after layout if guaranteed mounted).

---

## Senior recommendation

### Cleanest way to apply a preset “atomically” (URL + columns in one user action)

1. **Single client handler** (e.g. on an “Ansicht” / preset control) that:
   - Builds the target **`URLSearchParams`** (or uses nuqs batch setters if extended) and calls **`router.replace`** (and optionally **`refreshTripsPage()`** from `useTripsRscRefresh` to match `updateFilters` behavior and avoid stale RSC).
   - Reads **`useTripsTableStore.getState().table`**; if non-null, calls **`table.setColumnVisibility(partialVisibility)`** (merge with current state as needed) **or** uses TanStack’s updater form to avoid dropping keys.
2. If the preset includes **`view=list`** when the user was on Kanban, **either**:
   - apply URL first and **queue** column visibility in a small “pending preset” slice (Zustand or ref) that **`TripsTable` consumes on mount**; **or**
   - apply columns in a `useEffect` that runs when `table` transitions from null → non-null after navigation.

Reusing **`TripsFiltersBar`’s `updateFilters`** for URL-only keeps one source of truth for filter param names and `refreshTripsPage()`; a preset module could import/share that helper or duplicate the param contract carefully.

### Risks / gotchas — placing “Ansichten” in the header actions row

[`PageContainer`](../../src/components/layout/page-container.tsx) already wraps header actions with **`overflow-x-auto`** to mitigate horizontal pressure next to the title/description.

**Risks:**

- **Narrow breakpoints:** Adding another control beside Print / CSV / Bulk upload increases overflow scroll frequency; ensure accessible tap targets and stable order.
- **`TripsPageHeaderActions` is not under `TripsRscRefreshProvider`’s children in the tree** — actually **`FahrtenPageShell` wraps the entire `PageContainer`**, so header actions **are** inside `TripsRscRefreshProvider`. Good for calling `refreshTripsPage()` from future preset UI if needed.
- **No `table` on Kanban:** Presets that only make sense for the list (columns) must guard on **`view === 'list'`** or handle deferred apply after mount.
- **Source of truth:** Presets must update **TanStack table state** for columns; updating only Zustand `setColumnVisibility` without the table is incorrect given the current sync direction.

---

## References (files read)

- [`src/app/dashboard/trips/fahrten-page-shell.tsx`](../../src/app/dashboard/trips/fahrten-page-shell.tsx)
- [`src/app/dashboard/trips/page.tsx`](../../src/app/dashboard/trips/page.tsx)
- [`src/app/dashboard/trips/trips-header-actions.tsx`](../../src/app/dashboard/trips/trips-header-actions.tsx)
- [`src/components/layout/page-container.tsx`](../../src/components/layout/page-container.tsx)
- [`src/features/trips/components/trips-filters-bar.tsx`](../../src/features/trips/components/trips-filters-bar.tsx)
- [`src/features/trips/stores/use-trips-table-store.ts`](../../src/features/trips/stores/use-trips-table-store.ts)
- [`src/features/trips/components/trips-tables/index.tsx`](../../src/features/trips/components/trips-tables/index.tsx)
- [`src/features/trips/components/trips-tables/columns.tsx`](../../src/features/trips/components/trips-tables/columns.tsx) (column ids)
- [`src/lib/searchparams.ts`](../../src/lib/searchparams.ts)
- Grep sample: `zustand` + `persist` in [`use-kanban-pending-store.ts`](../../src/features/trips/stores/use-kanban-pending-store.ts), [`use-bulk-upload-resume-store.ts`](../../src/features/trips/stores/use-bulk-upload-resume-store.ts)
