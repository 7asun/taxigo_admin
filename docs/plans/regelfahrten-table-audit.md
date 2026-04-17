# Regelfahrten Table Audit

**Date:** 2026-04-17  
**Scope:** `/dashboard/regelfahrten` page — data query, pagination count, insert paths

---

## Files Traced

| Role | File |
|---|---|
| RSC entry point | `src/app/dashboard/regelfahrten/page.tsx` |
| Client table shell | `src/features/recurring-rules/components/recurring-rules-overview.tsx` |
| Column definitions | `src/features/recurring-rules/components/recurring-rules-columns.tsx` |
| Server data fetch | `src/features/trips/api/recurring-rules.server.ts` → `getAllRules()` |
| Client-side service | `src/features/trips/api/recurring-rules.service.ts` → `recurringRulesService` |
| Create sheet (overview) | `src/features/recurring-rules/components/create-recurring-rule-sheet.tsx` |
| Create/edit sheet (client detail) | `src/features/clients/components/recurring-rule-sheet.tsx` |
| Payload builder | `src/features/clients/lib/build-recurring-rule-payload.ts` |
| Table hook | `src/hooks/use-data-table.ts` |
| Pagination component | `src/components/ui/table/data-table-pagination.tsx` |

---

## Architectural overview (read before the Q&A)

The `/regelfahrten` page is a **pure RSC** with **no React Query**. The entire data lifecycle is:

```
getAllRules()           ← single .from('recurring_rules').select('*,...embeds')
  ↓
filterByGuest(all, sp.client_name)   ← in-memory, RSC
  ↓
sortRows(filtered, sorting)          ← in-memory, RSC
  ↓
totalDatasetCount = sorted.length    ← the count shown in pagination (NOT a DB count)
  ↓
pageRows = sorted.slice(from, from + perPage)  ← the rows shown in the table
  ↓
<RecurringRulesOverview
  rules={pageRows}
  totalDatasetCount={totalDatasetCount}
/>
```

`RecurringRulesOverview` is a `'use client'` presentational shell. It calls `useDataTable` with
`manualPagination: true`, `manualSorting: true`, `manualFiltering: true` — TanStack Table never
re-filters, re-sorts, or re-paginates the already-sliced `rules` prop. All state changes
(filter input, page clicks, sort clicks) update URL params via `nuqs` with `shallow: false`,
which triggers a Next.js RSC refresh, causing the server to re-slice and re-pass props.

---

## Q1 — Table name & shape

**What table does the data query read from?**  
`recurring_rules` — in `getAllRules()` (`recurring-rules.server.ts` line 36):
```ts
const { data, error } = await supabase
  .from('recurring_rules')
  .select(`*, billing_variant:billing_variants (...), clients (...)`)
  .order('created_at', { ascending: false });
```

**What table does the pagination count query read from?**  
There is **no separate count query**. The count is derived in the RSC page (`page.tsx` line 147):
```ts
const totalDatasetCount = sorted.length;
```
`sorted` is the result of `sortRows(filterByGuest(all, guest))` — the same in-memory array
built from the single `getAllRules()` call.

**Are they the same table?**  
They cannot diverge because they share the same origin. `totalDatasetCount` and `pageRows`
are both computed from the same `all` array returned by `getAllRules()`. There is no separate
count branch that could read a different table or apply different filters.

> **Verdict: no table mismatch. This class of bug is definitively ruled out.**

---

## Q2 — Select clause

**Exact `.select()` from `getAllRules()`:**
```ts
.select(`
  *,
  billing_variant:billing_variants (
    id,
    name,
    code,
    billing_type_id,
    billing_types ( name, color )
  ),
  clients (
    id,
    first_name,
    last_name
  )
`)
.order('created_at', { ascending: false })
```

**Is there a `.limit()`, `.range()`, or `.eq()` that could return 0 rows while the count is
unfiltered?**  
No. `getAllRules()` has **no `.limit()`**, no `.range()`, no `.eq()` — it fetches every row in
the table the authenticated user can see via RLS. Filtering, sorting, and pagination all happen
in-memory inside the RSC page after the full result set is fetched.

---

## Q3 — Filter / RLS mismatch

**Does the data query apply any filter the count does not, or vice versa?**  
No. Both `pageRows` and `totalDatasetCount` are derived from the same filtered, sorted array.
The guest filter (`filterByGuest`) and sort (`sortRows`) are applied to the array first, then:
```ts
const totalDatasetCount = sorted.length;        // count after filter+sort
const pageRows = sorted.slice(from, from + perPage); // page slice after filter+sort
```
There is no branch where the count is computed on an unfiltered set while the rows are filtered
(or vice versa).

**Is Row Level Security enabled?**  
RLS is in effect on the Supabase side, but it applies equally to the single `getAllRules()` call.
`getAllRules()` uses the server-side client (`@/lib/supabase/server`) which reads the session
cookie and runs under the user's auth context. There is no second query (with a different auth
context) for the count.

---

## Q4 — React Query key mismatch

**Not applicable.** The page uses **no React Query**. There are no `queryKey`s, no TanStack
Query caches, and no stale-cache risk of the form "count is fresh, data rows are from an old
cache entry." The data flow is entirely:

```
URL change → Next.js RSC re-render → getAllRules() → in-memory filter/sort/slice → props
```

---

## Q5 — Data shape returned

**What does the component consume?**

In `RecurringRulesOverview`:
```tsx
export function RecurringRulesOverview({
  rules,            // RecurringRuleWithClientEmbed[]  ← the current page slice
  totalDatasetCount, // number ← filtered total, not page-row count
  perPage,
  currentPage
}: RecurringRulesOverviewProps)
```

`rules` is passed directly to `useDataTable({ data: rules, ... })` — no `.data` unwrapping,
no double-nesting. The type `RecurringRuleWithClientEmbed` (defined in
`recurring-rules.server.ts`) matches the `ColumnDef<RecurringRuleWithClientEmbed>[]` in
`recurring-rules-columns.tsx`. No shape mismatch.

`totalDatasetCount` flows directly to `DataTable`'s `paginationProps`:
```tsx
paginationProps={{
  totalDatasetCount,
  datasetNounPlural: 'Regeln'
}}
```
`DataTablePagination` uses `totalDatasetCount` only for display text — it does not affect which
rows TanStack Table renders.

---

## Q6 — Client detail page insert

**`RecurringRuleSheet` (client detail page, `src/features/clients/components/recurring-rule-sheet.tsx`):**
```ts
await recurringRulesService.createRule(ruleData);
// or
await recurringRulesService.updateRule(initialData.id, ruleData);
```

**`recurringRulesService.createRule` (`recurring-rules.service.ts` line 58–67):**
```ts
async createRule(rule: InsertRecurringRule) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('recurring_rules')   // ← table
    .insert(rule)
    .select()
    .single();
  ...
}
```

**`CreateRecurringRuleSheet` (overview page, line 171):**
```ts
await recurringRulesService.createRule(ruleData);
```
Same function — same table.

**Columns written (from `buildRecurringRulePayload`):**
`client_id`, `rrule_string`, `payer_id`, `billing_variant_id`, `kts_document_applies`,
`kts_source`, `no_invoice_required`, `no_invoice_source`, `fremdfirma_id`,
`fremdfirma_payment_mode`, `fremdfirma_cost`, `pickup_time`, `pickup_address`,
`dropoff_address`, `return_mode`, `return_trip`, `return_time`, `start_date`, `end_date`,
`is_active`.

These are a subset of `recurring_rules` columns and are all columns that `getAllRules()` fetches
via `*`. **The insert and read paths are fully consistent.**

---

## Q7 — Senior recommendation

### Root cause verdict

There is **no query-level bug** of the form that was being investigated (mismatched table names,
split data/count queries, stale React Query cache). The architecture is clean:
- One DB query, one in-memory filter+sort, one slice for rows, `array.length` for the count.
- All three come from the same source — they cannot diverge.
- Insert paths on both the overview and client detail pages target the same `recurring_rules` table.

### The one real footgun — stale `page` param after filter change

There is a **UI-level empty-table scenario** that is not a bug in the code but can look like one
to users:

1. User is on page 3 (`?page=3`), unfiltered — sees 50 rows, count "150 Regeln gesamt".
2. User types a name in the filter — the RSC re-fires and finds, say, 5 matching rows.
3. `from = (3 - 1) * 50 = 100`.  `pageRows = sorted.slice(100, 150)` → `[]`.
4. **Table shows "No results."** but pagination shows **"0 von 5 Regeln"**.

The code in `DataTablePagination` already detects this (`pageRowCount === 0 && totalDatasetCount > 0`)
and renders `"0 von 5 Regeln"` rather than `"0 gesamt"`, which is a good defensive guard.
But the empty table is still confusing.

**Minimal fix:**  
In `page.tsx`, after computing `from`, clamp the page back to the last valid page if it is
out of range:

```ts
// After: const totalDatasetCount = sorted.length;
const lastPage = Math.max(1, Math.ceil(totalDatasetCount / perPage));
const safePage = Math.min(page, lastPage);
const from = (safePage - 1) * perPage;
const pageRows = sorted.slice(from, from + perPage);
```

And pass `safePage` instead of `page` to `RecurringRulesOverview.currentPage` so the client
table's URL is also corrected on the next navigation. This ensures the table is never empty
when the dataset is non-empty — users land on the last valid page instead of an out-of-range
empty page.

---

## Summary table

| Question | Finding | Severity |
|---|---|---|
| Table mismatch? | None — single fetch, no split | ✅ Clean |
| Separate count query? | No — `sorted.length` | ✅ Clean |
| `.limit()` / `.eq()` cutting data? | None on `getAllRules()` | ✅ Clean |
| Filter applied to data but not count? | Impossible — same array | ✅ Clean |
| RLS context mismatch? | N/A — single query | ✅ Clean |
| React Query stale cache? | No React Query used | ✅ N/A |
| Data shape unwrap error? | No — direct prop, correct type | ✅ Clean |
| Insert → wrong table? | Both paths write `recurring_rules` | ✅ Clean |
| Stale `page` after filter narrows result | Empty rows while count > 0 | ⚠️ UX footgun |
