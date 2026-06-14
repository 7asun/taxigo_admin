# Regelfahrten filter audit — `formatRecurringRuleGuestLabel` server/client boundary

**Date:** 2026-06-12  
**Scope:** Runtime error when searching on `/dashboard/regelfahrten` — *"Attempted to call formatRecurringRuleGuestLabel() from the server but formatRecurringRuleGuestLabel is on the client."*  
**Code changes:** None (audit only).

---

## Directory: `src/app/dashboard/regelfahrten/`

| File | Role |
|------|------|
| `page.tsx` | Sole route file — async RSC entry; loads rules, applies guest filter / sort / pagination from URL, renders `RecurringRulesOverview`. |

No other files exist in this directory (no `loading.tsx`, layout, or hooks).

---

## 1. Where is `formatRecurringRuleGuestLabel` defined?

**File:** `src/features/recurring-rules/components/recurring-rules-columns.tsx`  
**Lines:** 43–51

**Exact function signature:**

```ts
export function formatRecurringRuleGuestLabel(
  row: RecurringRuleWithClientEmbed
): string
```

**Import in `page.tsx`:** lines 19–22 — direct import from `@/features/recurring-rules/components/recurring-rules-columns` (not via a barrel).

---

## 2. `"use client"` / `"use server"` in that file

| Line | Directive |
|------|-----------|
| 1 | `'use client';` |

No `"use server"` directive in `recurring-rules-columns.tsx`.

The entire module is a Client Component boundary because it exports TanStack column definitions that use React JSX (`Link`, `Badge`, `DropdownMenu`, etc.).

---

## 3. Barrel / index re-exports

**None.** Grep across `**/index.ts*` found no barrel that re-exports `formatRecurringRuleGuestLabel`. All consumers import directly from `recurring-rules-columns.tsx` (e.g. `page.tsx` line 22, `expiring-rules-banner.tsx` line 9).

---

## 4. Does `page.tsx` have `"use client"`?

**No.**

**Line 1 of `page.tsx` (exact):**

```ts
/**
```

The file is a Server Component: default export is `async function Page` (line 141), with no `'use client'` anywhere in the file. The file comment (lines 1–7) explicitly describes it as the *"RSC entry"*.

---

## 5. What does `filterByGuest` do? (full function)

**File:** `src/app/dashboard/regelfahrten/page.tsx`  
**Lines:** 51–62

```ts
function filterByGuest(
  rows: RecurringRuleWithClientEmbed[],
  guest: string
): RecurringRuleWithClientEmbed[] {
  const q = guest.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const label = formatRecurringRuleGuestLabel(r).toLowerCase();
    const hay = `${label} ${r.client_id}`.toLowerCase();
    return hay.includes(q);
  });
}
```

**Behavior:** Trims/lowercases the search string `guest`. If empty, returns all rows. Otherwise filters rows where the concatenation of the formatted guest label (`last_name, first_name` from embedded `clients`) and `client_id` contains the query (case-insensitive substring match).

---

## 6. Where is `filterByGuest` called? Call context

**Call site:** `src/app/dashboard/regelfahrten/page.tsx`, line 158

**Surrounding context (lines 153–164):**

```ts
  const page = parsePositiveInt(firstString(sp.page), 1, 10_000);
  const perPage = parsePositiveInt(
    firstString(sp.perPage),
    RECURRING_RULES_TABLE_DEFAULT_PAGE_SIZE,
    500
  );

  const all = await getAllRules();
  const filtered = filterByGuest(all, guest);
  const sorted = sortRows(filtered, sorting);
  const totalDatasetCount = sorted.length;
  const lastPage = Math.max(1, Math.ceil(totalDatasetCount / perPage));
  const safePage = Math.min(page, lastPage); // clamp page to last valid page so slice never overshoots a small dataset
  const from = (safePage - 1) * perPage;
  const pageRows = sorted.slice(from, from + perPage);
```

**Context classification:** Called **during the render of the async Server Component** (`Page`), after `await getAllRules()` and before JSX return. It is **not** inside `useEffect`, an event handler, or a Client Component.

The `guest` argument is derived earlier in the same server render (line 143):

```ts
const guest = firstString(sp.client_name) ?? '';
```

---

## 7. What does `formatRecurringRuleGuestLabel` actually do? Server-safe?

**Implementation** (`recurring-rules-columns.tsx`, lines 43–51):

```ts
export function formatRecurringRuleGuestLabel(
  row: RecurringRuleWithClientEmbed
): string {
  const c = row.clients;
  const last = c?.last_name?.trim() ?? '';
  const first = c?.first_name?.trim() ?? '';
  if (!last && !first) return '—';
  return `${last}, ${first}`;
}
```

**Assessment:** **Computationally server-safe.** Pure string/object field reads on `row.clients` — no browser APIs, no React hooks, no React context, no `window`/`document`, no `date-fns` usage in this function.

It is **client-only only because of module placement**: it lives in a file topped with `'use client'` (line 1), which Next.js treats as a Client Component module; exporting a plain function from that module still marks the export as callable only on the client when imported into a Server Component.

**Related:** `formatRecurringRuleByDayAbbrev` (same file, lines 53–57) is equally pure (regex + map on `rrule_string`) and is also called from the server page in `compareColumn` (lines 76–77) — same boundary violation when sorting by `days`.

---

## 8. Client-side vs server-side filter — how does `q` reach `filterByGuest`?

**Architecture:** **Server-side filtering driven by URL search params**, with **client-side UI** updating those params.

| Step | Location | What happens |
|------|----------|--------------|
| 1 | Client — `RecurringRulesOverview` | `useDataTable` with `shallow: false` (`recurring-rules-overview.tsx` line 58) |
| 2 | Client — `use-data-table.ts` | Column filter on `client_name` (`recurring-rules-columns.tsx` lines 75–97, `enableColumnFilter: true`) syncs to URL via `nuqs` `useQueryStates` (lines 194–212, 251–283) |
| 3 | Client → server | User types in toolbar → debounced URL update → `?client_name=...` (and `page` reset as needed) → **full navigation / RSC refresh** because `shallow: false` |
| 4 | Server — `page.tsx` | `searchParams` → `guest = firstString(sp.client_name) ?? ''` (line 143) → `filterByGuest(all, guest)` (line 158) |

`useDataTable` sets `manualFiltering: true` (`use-data-table.ts` line 319), so TanStack does **not** filter rows in the browser; the server owns filter/sort/pagination (see `page.tsx` comment lines 1–4 and `recurring-rules-overview.tsx` lines 3–9).

**Summary:** Search is **not** purely client-side row filtering. The query reaches `filterByGuest` as the **`client_name` URL search param**, read on the server on each RSC render after the user changes the filter in the client toolbar.

---

## 9. Other imports on `page.tsx` with `"use client"` restriction

Imports from `page.tsx` (lines 9–26) audited for client boundary:

| Import | Source | Client boundary? | Used how on server |
|--------|--------|------------------|-------------------|
| `formatRecurringRuleGuestLabel` | `recurring-rules-columns.tsx` | **Yes** (`'use client'` line 1) | **Called** in `filterByGuest` (58) and `compareColumn` (71–72) — **violates boundary** |
| `formatRecurringRuleByDayAbbrev` | `recurring-rules-columns.tsx` | **Yes** (same file) | **Called** in `compareColumn` (76–77) — **violates boundary** when sorting by `days` |
| `RecurringRulesOverview` | `recurring-rules-overview.tsx` (`'use client'` line 1) | Yes | **JSX only** (lines 173–178) — **allowed** |
| `PageContainer` | `@/components/layout/page-container` | No `'use client'` | JSX — OK |
| `getAllRules`, `RecurringRuleWithClientEmbed` | `recurring-rules.server` | Server module | `await getAllRules()` — OK |
| `RECURRING_RULES_*` | `recurring-rules-sort-column-ids.ts` | Explicitly non-client (file comment lines 1–7) | Constants — OK |
| `getSortingStateParser` | `@/lib/parsers` (`nuqs/server`) | Server-safe | `parseServerSide` — OK |
| `formatBillingDisplayLabel` | `format-billing-display-label.ts` | No `'use client'` | Called in `compareColumn` — OK |
| `recurringReturnModeFromRow` | `recurring-return-mode.ts` | No `'use client'` | Called in `compareColumn` — OK |

**Functions imported from client modules and invoked on the server:** `formatRecurringRuleGuestLabel`, `formatRecurringRuleByDayAbbrev`. No other client-only **function** imports are called from the server page.

---

## 10. Senior recommendation

**Simplest fix: extract shared (non-client) utilities** — move `formatRecurringRuleGuestLabel` and `formatRecurringRuleByDayAbbrev` into a small server-safe module under e.g. `src/features/recurring-rules/lib/` (mirroring the existing pattern in `recurring-rules-sort-column-ids.ts`, whose comment already warns against importing from `'use client'` modules in the RSC page). Re-export or import those helpers from `recurring-rules-columns.tsx` for column `accessorFn`/cells.

**Do not move `filterByGuest` into a Client Component** as the primary fix: the page is intentionally designed for server-side filter, sort, and pagination over the full dataset via URL params (`page.tsx` lines 1–4; `recurring-rules-overview.tsx` lines 3–9). Moving filtering client-side would require either shipping all rules to the browser or re-architecting data loading, duplicating logic already shared with `compareColumn` on the server.

**Trade-off in brief:** Extracting ~15 lines of pure formatters is a minimal, one-time change that preserves the current RSC + `manualFiltering` contract and fixes both guest search and `days`/`client_name` sort. Moving filter logic to the client would fight the established trips-style pattern, increase bundle size or API surface, and split filter/sort formatting between server and client unless the entire pipeline moved client-side.

---

## Error reproduction path (concise)

1. User opens `/dashboard/regelfahrten` (server render succeeds when `client_name` is empty — `filterByGuest` returns early at line 56).
2. User types in Fahrgast filter → URL gains `client_name=...` → RSC re-renders.
3. Server `Page` calls `formatRecurringRuleGuestLabel(r)` inside `filterByGuest` (line 58).
4. Next.js throws: client export invoked from Server Component.

**Secondary trigger:** Sorting by Fahrgast or Wochentage invokes the same client exports in `compareColumn` (lines 71–72, 76–77) during `sortRows` on the server.

---

## Resolution

**Date applied:** 2026-06-12

**Fix:** Extracted `formatRecurringRuleGuestLabel` and `formatRecurringRuleByDayAbbrev` into a new server-safe module; RSC page imports from there; client columns module re-exports for backward compatibility.

| File | Change |
|------|--------|
| `src/features/recurring-rules/lib/recurring-rules-formatters.ts` | **Created** — pure formatters + `DAY_MAP`; no `'use client'`. |
| `src/features/recurring-rules/components/recurring-rules-columns.tsx` | Removed inline formatter bodies; imports + re-exports from `../lib/recurring-rules-formatters`. |
| `src/app/dashboard/regelfahrten/page.tsx` | Import path changed from `recurring-rules-columns` to `recurring-rules-formatters`. |
| `docs/features/recurring-rules-overview.md` | Added Files table entry for `recurring-rules-formatters.ts`. |

**Status:** Applied. `bun run build` passes. Guest filter and Wochentage sort no longer cross the server/client boundary.
