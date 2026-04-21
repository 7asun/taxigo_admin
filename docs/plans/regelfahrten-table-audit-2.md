# Regelfahrten Table Audit — Second Pass (Deep Trace)

**Date:** 2026-04-17  
**Scope:** Six targeted questions on props, return values, TanStack data flow, column compat,
counter source, and null guards.

---

## Q1 — Props received by RecurringRulesOverview

### Exact value passed as `rules`

```tsx
// page.tsx lines 158–163
<RecurringRulesOverview
  rules={pageRows}          // ← this value
  totalDatasetCount={totalDatasetCount}
  perPage={perPage}
  currentPage={page}
/>
```

### Full transformation chain from `getAllRules()` to the prop

```
Step 1  const all = await getAllRules();
           // RecurringRuleWithClientEmbed[] — full DB result set

Step 2  const filtered = filterByGuest(all, guest);
           // guest = firstString(sp.client_name) ?? ''
           // if guest is '', returns `all` unchanged (line 56: `if (!q) return rows`)
           // if guest is non-empty, returns rows matching the label/client_id string

Step 3  const sorted = sortRows(filtered, sorting);
           // if sorting is [], returns `filtered` unchanged (line 114: `if (sorting.length === 0) return rows`)
           // otherwise returns [...filtered].sort(...)

Step 4  const totalDatasetCount = sorted.length;   // ← the counter value

Step 5  const from = (page - 1) * perPage;

Step 6  const pageRows = sorted.slice(from, from + perPage);
           // ← this is what lands in <RecurringRulesOverview rules={pageRows} />
```

### Is there ANY step that can produce `[]` even when `getAllRules()` returns rows?

**YES. Step 6 is the only one.**

`Array.prototype.slice(from, to)` returns `[]` when `from >= sorted.length`, regardless of
how many elements are in `sorted`. This happens when the `page` URL param is set to a value
that places `from` beyond the end of the filtered dataset:

```
sorted.length = 1,  page = 2,  perPage = 50
from  = (2 - 1) * 50 = 50
pageRows = sorted.slice(50, 100) = []   // empty even though sorted has 1 element
totalDatasetCount = 1                   // non-zero, because it's sorted.length
```

Steps 1–3 have no path that silently discards rows:
- `filterByGuest` returns the full array when `guest` is empty string (line 56).
- `sortRows` returns the input unchanged when no sorting is active (line 114).
- Neither wraps the result in a new object, applies a type guard, or adds a `?? []` fallback.

---

## Q2 — getAllRules() return value

### Does it return a wrapped object or a flat array?

Flat array. The function signature and return statement are unambiguous:

```ts
// recurring-rules.server.ts lines 33 and 57
export async function getAllRules(): Promise<RecurringRuleWithClientEmbed[]> {
  ...
  return (data ?? []) as RecurringRuleWithClientEmbed[];
}
```

It does **not** return `{ data, error }`, `{ rules: data }`, or any other wrapper. It either
throws (on error) or returns an array.

### Does the caller destructure it?

No. The caller (page.tsx line 144):

```ts
const all = await getAllRules();
```

`all` is directly the array. There is no destructuring. Because the function does not return a
wrapper, the absence of destructuring is correct — not a bug.

**"The whole-object-instead-of-array" bug is not present here.** If `getAllRules()` had returned
`{ data, error }` and the caller had done `const all = await getAllRules()` without destructuring,
`all` would be `{ data: [...], error: null }`, `filterByGuest` would receive an object, and
`rows.filter(...)` would return `[]` (since `[].filter` on a non-array in JS throws, but
`filterByGuest`'s body calls `.filter()` on its first argument which is typed as an array).
That scenario is **not happening**.

---

## Q3 — TanStack Table data flow in useDataTable

### What is the `data` option passed to `useReactTable`?

`data` is included in `...tableProps` — everything in the `UseDataTableProps` that is NOT
explicitly destructured out. The destructuring in `useDataTable` (lines 68–81) pulls out:
`columns`, `pageCount`, `initialState`, `history`, `debounceMs`, `throttleMs`,
`clearOnDefault`, `enableAdvancedFilter`, `scroll`, `shallow`, `startTransition`.
Everything else — including `data` and `getRowId` — remains in `tableProps` and is spread
into `useReactTable`:

```ts
const table = useReactTable({
  ...tableProps,   // ← data: rules lands here, untransformed
  columns,
  initialState,
  pageCount,
  state: { ... },
  ...
});
```

### Is there any `useMemo` or transformation on `data` before it reaches `useReactTable`?

**None.** `data` is never touched between the call site (`RecurringRulesOverview` line 47:
`data: rules`) and `useReactTable`. It passes through `...tableProps` with no wrapping,
memoisation, or conditional fallback.

### Does `useDataTable` apply any filtering that could hide rows?

Three manual flags are hard-coded at the bottom of `useReactTable` call:

```ts
manualPagination: true,   // line 302
manualSorting: true,      // line 303
manualFiltering: true     // line 304
```

These cannot be overridden — the `UseDataTableProps` interface `Omit`s them (lines 49–51).

**Effect of `manualFiltering: true`:**  
TanStack Table v8 skips its own row-filtering logic when this flag is set. The
`getFilteredRowModel()` included in the call (line 296) still runs but returns all rows from
`getCoreRowModel()` unchanged. The `columnFilters` state (populated from URL params via
`initialColumnFilters`) is stored in table state for the filter-input UI, but it does **not**
cause any rows to be hidden from the rendered output.

**Effect of `manualPagination: true`:**  
TanStack Table v8's `getPaginationRowModel()` checks this flag internally:
> "If `manualPagination` is `true`, return all rows from the previous model stage unchanged."

So `getPaginationRowModel` does NOT slice `rules` down to a page window. All elements of
`rules` are visible in `table.getRowModel()`.

**Conclusion:** If `rules` has N elements, `table.getRowModel().rows` will have exactly N
rows. TanStack applies zero further reduction.

---

## Q4 — RecurringRulesOverview — columnDef compatibility

### Type parameter

`useDataTable` is generic (`useDataTable<TData>`). The caller passes `data: rules` where
`rules: RecurringRuleWithClientEmbed[]`, so TypeScript infers `TData = RecurringRuleWithClientEmbed`.
`columns: recurringRulesColumns` is typed `ColumnDef<RecurringRuleWithClientEmbed>[]`.
Types are consistent.

### Do accessorKeys/accessorFns match the data shape?

Full column-by-column check:

| Column id | Accessor type | Value / key | Data field | Safe? |
|---|---|---|---|---|
| `client_name` | `accessorFn` | `formatRecurringRuleGuestLabel(row)` — reads `row.clients?.last_name`, `row.clients?.first_name` | top-level `clients` embed | ✅ |
| `days` | `accessorFn` | `formatRecurringRuleByDayAbbrev(row.rrule_string)` | top-level `rrule_string` | ✅ |
| `pickup_time` | `accessorKey` | `'pickup_time'` | top-level `pickup_time` | ✅ |
| `pickup_address` | `accessorKey` | `'pickup_address'` | top-level `pickup_address` | ✅ |
| `dropoff_address` | `accessorKey` | `'dropoff_address'` | top-level `dropoff_address` | ✅ |
| `return_mode` | `accessorFn` | reads `row.return_time`, calls `recurringReturnModeFromRow(row)` | top-level fields | ✅ |
| `billing` | `accessorFn` | `formatBillingDisplayLabel(row.billing_variant)` | top-level `billing_variant` embed | ✅ |
| `is_active` | `accessorKey` | `'is_active'` | top-level `is_active` | ✅ |
| `start_date` | `accessorKey` | `'start_date'` | top-level `start_date` | ✅ |

### Are there any dot-notation accessorKeys accessing nested objects?

**No.** Zero columns use a string like `'clients.first_name'` or `'billing_variant.name'` as
an `accessorKey`. Every nested field access happens inside explicit `accessorFn` closures or
inside `cell` renderers via `row.original.*`, neither of which causes TanStack to silently
return `undefined` for the row value.

**Conclusion:** Column definitions are fully compatible with the data shape. No hidden
`undefined` values that could cause rows to be invisible or blank.

---

## Q5 — The counter: how does "0 von 1 Regeln" happen while the table is empty?

### What drives the "1 Regeln" number in DataTablePagination?

The `totalDatasetCount` **prop** — not anything derived from the table instance:

```ts
// DataTablePagination.tsx lines 44–45 and 59–64
const pageRowCount = table.getRowModel().rows.length;   // ← from TanStack

if (pageRowCount === 0 && totalDatasetCount > 0) {
  return <>0 von {totalDatasetCount} {datasetNounPlural}</>;
}
return <>{totalDatasetCount} {datasetNounPlural} gesamt</>;
```

`pageRowCount` is read from TanStack (`table.getRowModel().rows.length`).  
`totalDatasetCount` is read from the external prop — it is **never derived or overridden** by
anything from the table instance.

### In RecurringRulesOverview, what is passed as `totalDatasetCount`?

The raw RSC prop, passed through unchanged:

```tsx
// recurring-rules-overview.tsx lines 64–70
<DataTable
  table={table}
  paginationProps={{
    totalDatasetCount,    // ← the prop received from page.tsx
    datasetNounPlural: 'Regeln'
  }}
>
```

And in `DataTable` (data-table.tsx line 187):
```tsx
<DataTablePagination table={table} {...paginationProps} />
```

So the chain is:
```
page.tsx:
  totalDatasetCount = sorted.length        (e.g. 1)
        ↓ prop
RecurringRulesOverview:
  paginationProps.totalDatasetCount        (still 1)
        ↓ spread
DataTable:
  <DataTablePagination totalDatasetCount={1} ... />
        ↓
DataTablePagination:
  "0 von 1 Regeln"  ← renders because pageRowCount === 0 and totalDatasetCount > 0
```

### What drives the table showing zero rows?

`DataTable` renders rows from `table.getRowModel().rows` (lines 150–151 and 63–66):

```tsx
{table.getRowModel().rows?.length ? (
  table.getRowModel().rows.map((row) => <TableRow ... />)
) : (
  <TableRow><TableCell ...>No results.</TableCell></TableRow>
)}
```

As established in Q3, `table.getRowModel().rows` = all elements of `data` (= `rules` prop) due
to the three `manual*: true` flags. Therefore:
- `table.getRowModel().rows.length = 0` ⟺ `rules.length = 0`

### The exact mismatch that produces "0 von 1 Regeln"

```
RSC page computation:
  sorted.length       = 1    → totalDatasetCount = 1  ✓ correct
  from                = (page - 1) * perPage
                      = (2 - 1) * 50 = 50  (if page=2, perPage=50)
  pageRows            = sorted.slice(50, 100) = []

Props to RecurringRulesOverview:
  rules               = []   → table shows 0 rows  → "No results."
  totalDatasetCount   = 1    → pagination shows "0 von 1 Regeln"
```

The counter says "1" because it uses the pre-slice value (`sorted.length`).  
The table says "0 rows" because it uses the post-slice value (`sorted.slice(from, ...)`).  
They are the **same RSC computation** but they read from **different stages of it**.

The `totalDatasetCount` is intentionally the full filtered count (not the page count), which is
correct for the counter. The bug is that the `page` URL param is stale (too high) relative to
the actual filtered dataset, causing `from` to overshoot.

**This is the complete and only root cause.** The mismatch is not a query mismatch, not a
React Query cache issue, not a column accessor bug, and not a wrapped return value. It is
entirely a stale `page` URL param that places `from` beyond `sorted.length`.

---

## Q6 — Null / undefined guards

### Is there any `?? []` or `|| []` that could silently mask a non-array?

Complete audit of every step in the chain:

| Location | Expression | Guard present? | Effect |
|---|---|---|---|
| `getAllRules()` return (line 57) | `(data ?? []) as ...[]` | `?? []` | If Supabase returns `null` for `data`, returns `[]`. Benign. |
| `page.tsx` line 144 | `const all = await getAllRules()` | none | `all` is the array; no masking needed. |
| `filterByGuest(all, guest)` | returns `rows` or `rows.filter(...)` | none | Returns same array reference or new filtered array. |
| `sortRows(filtered, sorting)` | returns `rows` or `[...rows].sort(...)` | none | Returns same or new array. |
| `sorted.slice(from, from + perPage)` | `Array.slice()` | none | Always returns an array (possibly empty). |
| `RecurringRulesOverview` props | `{ rules, totalDatasetCount, perPage, currentPage }` | none | Props typed as non-optional; passed as-is. |
| `useDataTable` — `data` in `...tableProps` | spread into `useReactTable` | none | No fallback. |
| `useReactTable({ ...tableProps })` | internal TanStack | TanStack uses `data ?? []` internally | If `data` were `undefined`, TanStack would use `[]`. |

**The only non-trivial guard is TanStack's own internal `data ?? []`.**  
If for any reason the `data` option reached `useReactTable` as `undefined` or `null`, TanStack
would silently render an empty table while `totalDatasetCount` would still show the server
value — producing exactly the "0 von N" symptom.

**However:** TypeScript types prevent this in normal operation (`rules: RecurringRuleWithClientEmbed[]`
is non-nullable), `page.tsx` always passes `pageRows` (which is always an array, possibly `[]`),
and there is no runtime code path that would produce `undefined` here.

The one case worth being aware of: if this component were ever rendered with `rules={undefined}`
(e.g. a future prop change making `rules` optional without a default), TanStack's internal guard
would silently eat it and the table would appear empty while the counter stays at its server value.

---

## Summary table

| Question | Finding | Root of "0 von 1 Regeln" |
|---|---|---|
| 1. Props received | `rules = sorted.slice(from, from+perPage)` — only this step can produce `[]` | ✅ Yes — when `from ≥ sorted.length` |
| 2. getAllRules return | Returns flat array; caller does not destructure | ✅ Not a bug |
| 3. TanStack data flow | `data` passed through untransformed; `manual*:true` flags prevent any row reduction | ✅ Not a bug |
| 4. Column defs | All accessors are compatible; zero dot-notation keys on nested objects | ✅ Not a bug |
| 5. Counter source | `totalDatasetCount` = `sorted.length` (pre-slice); rows = `rules` (post-slice); counter reads pre-slice, table reads post-slice | ✅ **THE MISMATCH** |
| 6. Null guards | No silent `?? []` masking in the active code path; TanStack internal guard could theoretically mask `undefined` but never receives it under current types | ✅ Not a bug today |

### Single root cause

The `page` URL param is stale. When the filtered dataset shrinks to fewer rows than
`(page - 1) * perPage`, `sorted.slice(from, ...)` returns `[]` while `sorted.length`
remains non-zero. The pagination shows the non-zero `sorted.length`; the table renders the
empty slice.

### Minimal fix

Clamp `page` to the last valid page before computing `from`, in `page.tsx` after line 147:

```ts
const totalDatasetCount = sorted.length;
const lastPage = Math.max(1, Math.ceil(totalDatasetCount / perPage));
const safePage = Math.min(page, lastPage);
const from = (safePage - 1) * perPage;
const pageRows = sorted.slice(from, from + perPage);
```

Pass `safePage` as `currentPage` to `RecurringRulesOverview` so the URL pagination indicator
also reflects the corrected page on the next render cycle.
