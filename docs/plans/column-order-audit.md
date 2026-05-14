# Audit — Column order state in TripsTable (read-only)

Sources: `use-trips-table-store.ts`, `trips-tables/index.tsx`, `trips-tables/columns.tsx`, plus `use-data-table.ts` where `TripsTable` obtains the table instance (referenced only where needed to answer “who passes `columnOrder` to TanStack”).

---

## 1. Column order state

### `useTripsTableStore` — `columnOrder` slice?

**No.** The store only defines `table`, `columnVisibility`, `pendingColumnVisibility`, and their setters.

```4:15:src/features/trips/stores/use-trips-table-store.ts
interface TripsTableStore {
  table: Table<any> | null;
  columnVisibility: VisibilityState;
  /**
   * Queued from “Ansichten” when switching Kanban → Liste: TanStack instance is
   * null until TripsTable mounts — we apply and clear in TripsTable’s effect.
   */
  pendingColumnVisibility: VisibilityState | null;
  setTable: (table: Table<any> | null) => void;
  setColumnVisibility: (visibility: VisibilityState) => void;
  setPendingColumnVisibility: (visibility: VisibilityState | null) => void;
}
```

There is **no** `columnOrder` field or setter in the Zustand store.

### Does `TripsTable` / `useDataTable` pass `columnOrder` to `useReactTable`?

**Not in `TripsTable` directly.** `TripsTable` only calls `useDataTable` with `data`, `columns`, `pageCount`, nuqs-related options, `getRowId`, `sortParserValidKeys`, and `initialState` (visibility only):

```46:61:src/features/trips/components/trips-tables/index.tsx
  const { table } = useDataTable({
    data,
    columns,
    pageCount: pageCount,
    shallow: false,
    debounceMs: 500,
    getRowId: (row) => (row as Trip).id,
    // Must match RSC `getSortingStateParser` + `TRIPS_SORT_MAP` — not every column `id`.
    sortParserValidKeys: TRIPS_SORTABLE_IDS,
    initialState: {
      columnVisibility: {
        net_price: false,
        tax_rate: false
      }
    }
  });
```

**Inside `useDataTable`** (hook used by `TripsTable`), `columnOrder` is **local React state** and is passed into TanStack `state` with **`onColumnOrderChange`** wired:

```120:122:src/hooks/use-data-table.ts
  const [columnOrder, setColumnOrder] = React.useState<string[]>(() =>
    columns.map((c: any) => c.id || c.accessorKey)
  );
```

```286:299:src/hooks/use-data-table.ts
  const table = useReactTable({
    ...tableProps,
    columns,
    initialState,
    pageCount,
    state: {
      pagination,
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      columnOrder
    },
    onColumnOrderChange: setColumnOrder,
```

### `onColumnOrderChange` wired today?

**Yes**, in `use-data-table.ts` line **299**: `onColumnOrderChange: setColumnOrder`. It is **not** defined or overridden in `TripsTable` / `trips-tables/index.tsx`.

---

## 2. Default column order

### Order of column `id`s in `columns.tsx` (array definition order)

The exported array is `export const columns: ColumnDef<any>[] = [` starting at line **56**. Each column’s primary identifier for ordering is **`id`** where present; `useDataTable` initializes `columnOrder` as `c.id || c.accessorKey` (see §1).

In **file order**:

| # | `id` (or fallback from initializer) | Notes |
|---|--------------------------------------|--------|
| 1 | `select` | `id: 'select'` (lines **57–58**) |
| 2 | `scheduled_at` | lines **79–80** |
| 3 | `time` | lines **105–106** |
| 4 | `name` | lines **143–144** |
| 5 | `pickup_address` | lines **175–176** |
| 6 | `dropoff_address` | lines **210–211** |
| 7 | `driver_id` | lines **248–249** |
| 8 | `status` | lines **262–263** |
| 9 | `gross_price` | lines **283–284** |
| 10 | `invoice_status` | lines **298–299** |
| 11 | `payer_name` | lines **317–318** |
| 12 | `fremdfirma` | lines **326–327** (uses `accessorFn`; `id` explicit) |
| 13 | `fremdfirma_abrechnung` | lines **358–359** |
| 14 | `billing_type` | lines **400–401** |
| 15 | `billing_calling_station` | lines **433–434** |
| 16 | `billing_betreuer` | lines **455–456** |
| 17 | `kts_document_applies` | lines **474–475** |
| 18 | `kts_fehler` | lines **498–499** |
| 19 | `kts_fehler_beschreibung` | lines **522–523** |
| 20 | `net_price` | lines **553–554** |
| 21 | `tax_rate` | lines **568–569** |
| 22 | `actions` | lines **585–586** (`id` implied last def; **`id: 'actions'`** at **586**) |

### Overridden in `TripsTable` initialization?

**No `columnOrder` in `TripsTable`.** Only `initialState.columnVisibility` is passed (lines **55–59** in `index.tsx`). Default order comes from `useDataTable`’s initializer `columns.map((c) => c.id || c.accessorKey)`, which follows the **`columns` array order** passed from `TripsTable` (the same `columns` import from `./columns`).

---

## 3. `reha_schein` column

### Present in `columns.tsx`?

**No.** A search of `columns.tsx` shows **no** `reha_schein` column definition.

### Semantically closest column (reference pattern)

**`kts_document_applies`** is the closest pattern: boolean trip flag, “off” shown as em dash, “on” as a compact `Badge` with title.

Full definition (lines **474–497**):

```474:497:src/features/trips/components/trips-tables/columns.tsx
  {
    id: 'kts_document_applies',
    accessorKey: 'kts_document_applies',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='KTS' />
    ),
    cell: ({ row }) => {
      const applies = !!row.original.kts_document_applies;
      if (!applies) {
        return <span className='text-muted-foreground'>—</span>;
      }
      return (
        <Badge
          variant='secondary'
          className='px-1.5 py-0 text-[10px] font-normal'
          title='Krankentransportschein (KTS) — laut Fahrt markiert'
        >
          KTS
        </Badge>
      );
    },
    meta: { label: 'KTS', variant: 'text' },
    enableColumnFilter: false
  },
```

---

## 4. `columnOrder` in TanStack Table

### Internal vs explicit state

In **TanStack Table v8**, `columnOrder` is part of **table state**. If you pass **`state.columnOrder`** and **`onColumnOrderChange`**, ordering is **controlled** from that state (as `useDataTable` does). If you omit them, TanStack still has internal behavior derived from the **`columns`** definition order; dragging/reordering features typically require the controlled state pattern (which this app already uses via `useDataTable`).

This codebase **does** pass explicit `columnOrder` + `onColumnOrderChange` from `useDataTable` (see §1).

### `getState().columnOrder` on the Zustand-stored table?

`TripsTable` stores the **`table` instance** from `useDataTable` in Zustand:

```72:75:src/features/trips/components/trips-tables/index.tsx
  React.useEffect(() => {
    setTable(table as any);
    return () => setTable(null);
  }, [table, setTable]);
```

The object is a TanStack **`Table`** from `useReactTable`. **`table.getState()`** exposes the full table state **including** `columnOrder` as long as it is part of the configured `state` object (it is, in `use-data-table.ts` lines **291–297**). So **`useTripsTableStore.getState().table?.getState().columnOrder`** (when `table` is non-null) is **accessible** in principle.

**Note:** Zustand does **not** mirror `columnOrder` in its own slice; only the **`table` reference** and **`columnVisibility`** (synced separately in `index.tsx` lines **84–87**) are in the store.

---

## Summary

| Topic | Finding |
|-------|---------|
| Zustand `columnOrder` | **Absent** |
| Who owns `columnOrder` | **`useDataTable`** local state + TanStack `state` / `onColumnOrderChange` |
| `TripsTable` overrides order | **No** (only initial visibility) |
| `reha_schein` in `columns.tsx` | **No** |
| Pattern for similar flag | **`kts_document_applies`** (lines 474–497) |
| `getState().columnOrder` on stored `table` | **Yes**, via TanStack API when `table` is set |
