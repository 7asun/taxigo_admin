# Audit: Regelfahrten list bug (new rule not visible)

Read-only audit of the standalone **Regelfahrten** overview (`/dashboard/regelfahrten`) versus the single-client recurring-rules view, focused on whether newly created rules could be excluded by query scoping, filters, or missing cache invalidation.

## 1) What Supabase query does the Regelfahrten list run?

The Regelfahrten page is an **RSC** (`src/app/dashboard/regelfahrten/page.tsx`) that fetches rules via the server-only helper `getAllRules()` (`src/features/trips/api/recurring-rules.server.ts`).

Exact query chain in `getAllRules()`:

- `.from('recurring_rules')`
- `.select(\`*, billing_variant:billing_variants(...), clients(...)\`)`
- `.order('created_at', { ascending: false })`

There are **no** `.eq(...)` / `.filter(...)` predicates in the Supabase query, so the query itself does **not** exclude:
- `is_active = false`
- date ranges
- a specific `client_id`

After fetching, the page applies **in-memory** transformations:
- **Guest filter**: `filterByGuest(all, guest)` uses URL search param `client_name` and matches against `formatRecurringRuleGuestLabel(row)` plus `row.client_id`.
- **Sorting**: URL `sort` param (via `getSortingStateParser`).
- **Pagination slice**: URL `page` + `perPage`, then `sorted.slice(from, from + perPage)`.

**Implication for “new rule not visible”:**
- If the user is on **page > 1**, creating a new rule (newest `created_at`) will place it on **page 1**. The page stays on the current `page` param after `router.refresh()`, so the user won’t see the new row unless they go back to page 1.
- If the user has an active `client_name` filter that doesn’t match the created rule’s client name/id, the new row will be filtered out.

## 2) What Supabase query does the client detail page run? What differs?

Client detail uses the browser service `recurringRulesService.getClientRules(clientId)` from `src/features/trips/api/recurring-rules.service.ts`.

Exact query chain in `getClientRules(clientId)`:

- `.from('recurring_rules')`
- `.select(\`*, billing_variant:billing_variants(...)\`)`
- `.eq('client_id', clientId)`
- `.order('created_at', { ascending: false })`

Differences vs Regelfahrten overview:
- **Scoped** by `.eq('client_id', clientId)` (single client).
- Does **not** embed `clients(...)` because the client is known.
- Runs in the **browser client** service (not the server helper).

Where it’s called:
- `src/features/clients/components/client-form.tsx` → `recurringRulesService.getClientRules(initialData.id)`
- `src/features/clients/components/client-detail-panel.tsx` → `recurringRulesService.getClientRules(activeClientId)`

## 3) Does the Regelfahrten list receive a client_id prop / param that scopes it?

No.

`/dashboard/regelfahrten` is cross-client. Its fetch is unscoped (`getAllRules()` has no `.eq('client_id', ...)`), and the page-level filtering is driven by URL search params:
- `client_name` (text filter)
- `sort`
- `page`, `perPage`

There is no `clientId` prop or route param involved.

## 4) After create: is there React Query cache invalidation? Does it match the list key?

No React Query list cache exists for the Regelfahrten overview.

- The overview list is fed by an **RSC** fetch (`getAllRules()`), not TanStack Query.
- The create flow (sheet) calls `recurringRulesService.createRule(...)` and then calls `onSuccess()`.
- In the overview wrapper (`src/features/recurring-rules/components/recurring-rules-overview.tsx`), `onSuccess={() => router.refresh()}` is used.

So the refresh mechanism is **`router.refresh()`**, not `queryClient.invalidateQueries(...)`.

## 5) Is there an is_active filter? What is the default is_active on create?

- **List query filter:** No `is_active` filter in `getAllRules()` and no `is_active` filter in the RSC page’s in-memory filtering.
- **Default value on create:**
  - `RecurringRuleFormBody` default values (`getRuleFormDefaults(null)`) set `is_active: true`.
  - `buildRecurringRulePayload(values, ...)` writes `is_active: values.is_active`.

Therefore, newly created rules default to **active** unless explicitly changed (and the Regelfahrten list would show inactive rules anyway, because there is no active-only filter).

## Summary: most likely reasons a newly created rule “doesn’t show” in Regelfahrten

1. **Pagination**: user is not on page 1; new rule appears at top of dataset → page 1 only.
2. **Text filter**: `client_name` filter excludes it.
3. (Less likely) **Create succeeded but data didn’t persist**: would require inspecting DB/network; not indicated by this audit because the RSC query is unfiltered and should include any inserted row.

---

# Follow-up investigation: “count correct, but table shows No results.”

## Step 1 — SQL verification (needs pasted results)

I cannot run SQL in your Supabase SQL editor from this environment. Paste the raw outputs for the three queries below and I’ll embed them here verbatim.

### Query A (latest rules)

```sql
SELECT id, client_id, pickup_time, return_mode,
       is_active, created_at
FROM recurring_rules
ORDER BY created_at DESC
LIMIT 5;
```

**Result A (paste here):**

```text
<pending>
```

### Query B (client exists)

```sql
SELECT id, first_name, last_name
FROM clients
WHERE id = '<client_id from Query A>';
```

**Result B (paste here):**

```text
<pending>
```

### Query C (equivalent join shape)

```sql
SELECT
  rr.id,
  rr.client_id,
  rr.return_mode,
  rr.is_active,
  c.id as client_joined_id,
  c.first_name,
  c.last_name
FROM recurring_rules rr
LEFT JOIN clients c ON c.id = rr.client_id
ORDER BY rr.created_at DESC
LIMIT 5;
```

**Result C (paste here):**

```text
<pending>
```

## Step 2 — Code path confirmation (read-only)

### 2.1 RSC pipeline: `allRules → filtered → sorted → slice`

In `src/app/dashboard/regelfahrten/page.tsx` the `rules` prop passed to the table is:

- `all = await getAllRules()`
- `filtered = filterByGuest(all, guest)` where `guest = searchParams.client_name ?? ''`
- `sorted = sortRows(filtered, sorting)`
- `totalDatasetCount = sorted.length`
- `pageRows = sorted.slice(from, from + perPage)`
- `<RecurringRulesOverview rules={pageRows} totalDatasetCount={totalDatasetCount} ... />`

So the array becomes empty **only** at the final slice step when:

- the filtered+sorted dataset is non-empty (`totalDatasetCount > 0`), **but**
- the current page window (`from…from+perPage`) contains no rows (e.g. `page` is out-of-range after filters or dataset shrink).

### 2.2 What does “No results.” actually mean here?

The “No results.” text is rendered by `src/components/ui/table/data-table.tsx` when:

- `table.getRowModel().rows.length === 0`

Since `useDataTable` is configured with `manualFiltering: true`, client-side column filters do not actually remove rows in-memory. Therefore, “No results.” on Regelfahrten almost always means **the server passed `rules=[]`** (empty page slice), not that the client-side filter hid them.

### 2.3 Is there a `recurring-rules-list.tsx` that filters further?

The file requested in the prompt does **not** exist:

- `src/features/recurring-rules/components/recurring-rules-list.tsx` (not present)

The Regelfahrten overview uses:

- `src/features/recurring-rules/components/recurring-rules-overview.tsx` → `DataTable` → `DataTableToolbar`
- No additional filtering is applied in that component besides what the RSC page provides.

## Step 3 — Likely root cause given the code

If you see:

- “`1 Regeln gesamt`” (i.e. `totalDatasetCount = 1`), but
- the table says “No results.”

then the most likely explanation is a **stale `page` search param** (e.g. `page=2` with only 1 total row), not `filterByGuest` silently excluding the row.

---

# Requested deep-dive audit (code-only, no SQL access here)

This section answers the latest checklist using only repository code. I cannot:
- open your Supabase SQL editor, or
- run an authenticated `/dashboard/*` session to capture server `console.log` output.

If you paste the requested terminal output + SQL results, I’ll add them verbatim.

## 1) PAGE.TSX — exact value of `rules` prop (instrumentation plan)

File: `src/app/dashboard/regelfahrten/page.tsx`

Pipeline (verbatim):
- `const all = await getAllRules();`
- `const filtered = filterByGuest(all, guest);`
- `const sorted = sortRows(filtered, sorting);`
- `const totalDatasetCount = sorted.length;`
- `const from = (page - 1) * perPage;`
- `const pageRows = sorted.slice(from, from + perPage);`
- `<RecurringRulesOverview rules={pageRows} totalDatasetCount={totalDatasetCount} perPage={perPage} currentPage={page} />`

**Important:** `page` and `perPage` are already parsed and safe:
- `page = parsePositiveInt(firstString(sp.page), 1, 10_000)`
- `perPage = parsePositiveInt(firstString(sp.perPage), RECURRING_RULES_TABLE_DEFAULT_PAGE_SIZE, 500)`

So `perPage` can’t be `undefined`/`NaN` here; the slice becomes empty when `from` is out of range for the post-filter dataset.

### Debug logs requested by the prompt

Add these logs temporarily (RSC → logs print to the server console where `next dev` runs):

```ts
const allRules = await getAllRules();
console.log('[DEBUG] allRules:', allRules.length, JSON.stringify(allRules.map((r) => r.id)));
const filtered = filterByGuest(allRules, guest);
console.log('[DEBUG] filtered:', filtered.length);
const sorted = sortRows(filtered, sorting);
console.log('[DEBUG] sorted:', sorted.length);
const from = (page - 1) * perPage;
const pageRows = sorted.slice(from, from + perPage);
console.log('[DEBUG] pageRows:', pageRows.length);
console.log('[DEBUG] from:', from, 'perPage:', perPage);
```

**Paste the console output here once captured:**

```text
<pending>
```

## 2) COLUMNS — every accessorKey/accessorFn and filterFn

File: `src/features/recurring-rules/components/recurring-rules-columns.tsx`

Columns list:

- **`client_name`**
  - **id**: `client_name`
  - **accessorFn**: `(row) => formatRecurringRuleGuestLabel(row)`
  - **filterFn**: none (default)
  - **enableColumnFilter**: `true` (meta variant text)
- **`days`**
  - **id**: `days`
  - **accessorFn**: `(row) => formatRecurringRuleByDayAbbrev(row.rrule_string)`
  - **filterFn**: none
- **`pickup_time`**
  - **id**: `pickup_time`
  - **accessorKey**: `'pickup_time'`
  - **filterFn**: none
- **`pickup_address`**
  - **id**: `pickup_address`
  - **accessorKey**: `'pickup_address'`
  - **filterFn**: none
- **`dropoff_address`**
  - **id**: `dropoff_address`
  - **accessorKey**: `'dropoff_address'`
  - **filterFn**: none
- **`return_mode`**
  - **id**: `return_mode`
  - **accessorFn**: returns `'' | 'Zeitabsprache' | HH:MM` derived from `recurringReturnModeFromRow(row)` and `row.return_time`
  - **filterFn**: none
- **`billing`**
  - **id**: `billing`
  - **accessorFn**: `formatBillingDisplayLabel(row.billing_variant).trim()`
  - **filterFn**: none
- **`is_active`**
  - **id**: `is_active`
  - **accessorKey**: `'is_active'`
  - **filterFn**: none
- **`start_date`**
  - **id**: `start_date`
  - **accessorKey**: `'start_date'`
  - **filterFn**: none

**Answer:** No column defines a custom `filterFn`. Also, `useDataTable` in this view uses `manualFiltering: true`, so client-side filtering does not remove rows from `table.getRowModel()`—the RSC page slice drives the rows.

## 3) DATA-TABLE — “No results.” condition

File: `src/components/ui/table/data-table.tsx`

The fallback row renders when:

```tsx
{table.getRowModel().rows?.length ? (
  table.getRowModel().rows.map((row) => (/* ... */))
) : (
  <TableRow>
    <TableCell colSpan={table.getAllColumns().length} className='h-24 text-center'>
      No results.
    </TableCell>
  </TableRow>
)}
```

So yes: it is effectively `table.getRowModel().rows.length === 0`.

## 4) RECURRING-RULES-OVERVIEW — how rules flows into DataTable/useDataTable

File: `src/features/recurring-rules/components/recurring-rules-overview.tsx`

- **data prop**: `useDataTable({ data: rules, columns: recurringRulesColumns, ... })` — **`rules` directly**, no transform.
- **filters**: no `state` override passed; `useDataTable` internally wires column filters to URL params, but with `manualFiltering: true` the server slice is the source of truth for actual visible rows.
- **pagination**: `pageCount = Math.max(1, Math.ceil(totalDatasetCount / perPage))`; `initialState.pagination` uses `perPage` and `currentPage`.
- **DataTable props**:
  - `<DataTable table={table} paginationProps={{ totalDatasetCount, datasetNounPlural: 'Regeln' }} />`

## 5) RLS CHECK (needs pasted results)

Please run and paste:

```sql
SELECT id, client_id, return_mode, is_active
FROM recurring_rules
ORDER BY created_at DESC
LIMIT 5;
```

```sql
SELECT current_user, auth.uid();
```

**SQL results (paste here):**

```text
<pending>
```


