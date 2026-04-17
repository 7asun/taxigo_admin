# Regelfahrten Audit — Third Pass (Exact Source Verification)

**Date:** 2026-04-17  
**Files read:** `src/app/dashboard/regelfahrten/page.tsx` (168 lines),
`src/features/trips/api/recurring-rules.server.ts` (59 lines)

---

## Q1 — EXACT source of `totalDatasetCount`

### Exact assignment lines (page.tsx lines 144–147)

```ts
const all = await getAllRules();
const filtered = filterByGuest(all, guest);
const sorted = sortRows(filtered, sorting);
const totalDatasetCount = sorted.length;
```

That is the **one and only assignment** of `totalDatasetCount` in the entire file.

### Is it ALWAYS `sorted.length`?

**Yes, unconditionally.** There is:

- **No second branch.** The file contains no `if`/`else`, no ternary, no `switch` around this
  assignment. There is no path through `Page()` that assigns `totalDatasetCount` to anything
  other than `sorted.length`.

- **No fallback value.** There is no `?? someOtherCount`, no `|| 0`, no default.

- **No separate DB count call.** The file contains exactly one Supabase-touching call:
  `getAllRules()` on line 144. There is no second `.from('recurring_rules').count()` or any
  other DB query anywhere in `page.tsx`.

- **No searchParam-derived count.** `totalDatasetCount` is never assigned from `sp.page`,
  `sp.perPage`, `sp.client_name`, or any other URL search parameter.

- **No cached value.** There is no `React.cache`, `unstable_cache`, `use()`, or any external
  store read that could supply a separate count.

`sorted` is built by a deterministic two-step transform of `all`:
```
all      = await getAllRules()
filtered = filterByGuest(all, guest)      // guest from sp.client_name ?? ''
sorted   = sortRows(filtered, sorting)    // sorting from sp.sort ?? []
totalDatasetCount = sorted.length
```

`sorted.length` equals `filtered.length` (sorting never adds or removes rows) and
`filtered.length` equals the number of rows in `all` whose guest label matches the
`client_name` search param. When `client_name` is absent or empty, `filtered === all`
(same reference, line 56 of page.tsx: `if (!q) return rows`), so `sorted.length === all.length`.

---

## Q2 — IS `getAllRules()` ACTUALLY CALLED?

### Is there any condition, early return, Suspense boundary, or error boundary
### that could cause `getAllRules()` to be skipped or return early?

**No.** Reading the complete `Page` function body (lines 128–167):

```ts
export default async function Page({ searchParams }: PageProps) {
  // 1. Await search params — no guard, no conditional
  const sp = await searchParams;

  // 2. Parse URL params — no conditional, no early return
  const guest = firstString(sp.client_name) ?? '';
  const sortRaw = firstString(sp.sort);
  const sorting = getSortingStateParser(...).parseServerSide(sortRaw) ?? [];
  const page = parsePositiveInt(firstString(sp.page), 1, 10_000);
  const perPage = parsePositiveInt(firstString(sp.perPage), RECURRING_RULES_TABLE_DEFAULT_PAGE_SIZE, 500);

  // 3. getAllRules() — called unconditionally
  const all = await getAllRules();
  const filtered = filterByGuest(all, guest);
  const sorted = sortRows(filtered, sorting);
  const totalDatasetCount = sorted.length;
  const from = (page - 1) * perPage;
  const pageRows = sorted.slice(from, from + perPage);

  // 4. Return JSX — no early return, no redirect, no conditional branch
  return (
    <PageContainer ...>
      <RecurringRulesOverview
        rules={pageRows}
        totalDatasetCount={totalDatasetCount}
        ...
      />
    </PageContainer>
  );
}
```

There is:

- **No `if` guard before `getAllRules()`.** The call on line 144 is unconditional.
- **No early `return` before line 144.** The only `return` statement in the function body is
  the JSX return on line 151. There is no `return redirect(...)`, no `return null`, and no
  `return <SomeErrorState />` before the data computation block.
- **No Suspense boundary inside `Page`.** `Page` is an async RSC; Suspense is handled by
  Next.js at the route level. There is no `<Suspense>` wrapper that could suspend the
  execution of the data-fetching block without calling `getAllRules()`.
- **No error boundary inside `Page`.** Error boundaries are React client-side constructs and
  cannot interrupt server-side async function execution. If `getAllRules()` throws, the RSC
  render fails and Next.js surfaces the nearest `error.tsx`. No partial execution where
  `getAllRules()` is skipped but the JSX is still returned.
- **No `try/catch` around `getAllRules()`.** If the Supabase query fails, the error propagates
  uncaught out of `Page()`. The component never reaches the JSX return with stale or empty data.
- **No authentication redirect.** There is no `auth()` call, no `redirect()`, no `notFound()`
  before `getAllRules()`.
- **`getAllRules()` itself** (recurring-rules.server.ts lines 33–58): it either returns
  `(data ?? []) as RecurringRuleWithClientEmbed[]` or throws. The `data ?? []` guard fires
  only if PostgREST returns `null` for the data field (extremely unusual; would indicate an
  empty result that the driver chose to represent as null rather than `[]`). Even in that
  case, `all = []`, `filtered = []`, `sorted = []`, and `totalDatasetCount = 0` — all values
  remain consistent with each other.

**`getAllRules()` is called on every render of this page, without exception.**

---

## Q3 — Full page.tsx verbatim

```ts
/**
 * Alle Regelfahrten — RSC entry: loads all rules via server Supabase, then applies
 * guest filter, sort, and pagination slice from URL search params so the client
 * `useDataTable` (manual*) contract matches trips. No `loading.tsx` yet — empty
 * or slow states follow the same pattern as other dashboard list pages until
 * we add a dedicated skeleton.
 */

import PageContainer from '@/components/layout/page-container';
import {
  getAllRules,
  type RecurringRuleWithClientEmbed
} from '@/features/trips/api/recurring-rules.server';
import { RecurringRulesOverview } from '@/features/recurring-rules/components/recurring-rules-overview';
import { RECURRING_RULES_TABLE_DEFAULT_PAGE_SIZE } from '@/features/recurring-rules/components/recurring-rules-overview';
import {
  formatRecurringRuleGuestLabel,
  formatRecurringRuleByDayAbbrev
} from '@/features/recurring-rules/components/recurring-rules-columns';
import { RECURRING_RULES_SORT_COLUMN_IDS } from '@/features/recurring-rules/lib/recurring-rules-sort-column-ids';
import { getSortingStateParser } from '@/lib/parsers';
import { formatBillingDisplayLabel } from '@/features/trips/lib/format-billing-display-label';
import { recurringReturnModeFromRow } from '@/features/trips/lib/recurring-return-mode';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard: Alle Regelfahrten'
};

export const dynamic = 'force-dynamic';

function firstString(
  value: string | string[] | undefined
): string | undefined {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value[0];
  return value;
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  max: number
): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

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

function compareColumn(
  a: RecurringRuleWithClientEmbed,
  b: RecurringRuleWithClientEmbed,
  columnId: string
): number {
  switch (columnId) {
    case 'client_name':
      return formatRecurringRuleGuestLabel(a).localeCompare(
        formatRecurringRuleGuestLabel(b),
        'de'
      );
    case 'days':
      return formatRecurringRuleByDayAbbrev(a.rrule_string).localeCompare(
        formatRecurringRuleByDayAbbrev(b.rrule_string),
        'de'
      );
    case 'pickup_time':
      return a.pickup_time.localeCompare(b.pickup_time);
    case 'pickup_address':
      return a.pickup_address.localeCompare(b.pickup_address, 'de');
    case 'dropoff_address':
      return a.dropoff_address.localeCompare(b.dropoff_address, 'de');
    case 'return_mode': {
      const ra = recurringReturnModeFromRow(a);
      const rb = recurringReturnModeFromRow(b);
      const order = (m: string) =>
        m === 'none' ? 0 : m === 'time_tbd' ? 1 : 2;
      const oa = order(ra);
      const ob = order(rb);
      if (oa !== ob) return oa - ob;
      return (a.return_time ?? '').localeCompare(b.return_time ?? '');
    }
    case 'billing':
      return formatBillingDisplayLabel(a.billing_variant).localeCompare(
        formatBillingDisplayLabel(b.billing_variant),
        'de'
      );
    case 'is_active':
      return Number(a.is_active) - Number(b.is_active);
    case 'start_date':
      return a.start_date.localeCompare(b.start_date);
    default:
      return 0;
  }
}

function sortRows(
  rows: RecurringRuleWithClientEmbed[],
  sorting: { id: string; desc: boolean }[]
): RecurringRuleWithClientEmbed[] {
  if (sorting.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const s of sorting) {
      const raw = compareColumn(a, b, s.id);
      if (raw !== 0) return s.desc ? -raw : raw;
    }
    return 0;
  });
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const sp = await searchParams;
  const guest = firstString(sp.client_name) ?? '';
  const sortRaw = firstString(sp.sort);
  const sorting =
    getSortingStateParser(RECURRING_RULES_SORT_COLUMN_IDS).parseServerSide(
      sortRaw
    ) ?? [];

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
  const from = (page - 1) * perPage;
  const pageRows = sorted.slice(from, from + perPage);

  return (
    <PageContainer
      scrollable={false}
      pageTitle='Alle Regelfahrten'
      pageDescription='Wiederkehrende Fahrten aller Fahrgäste im Überblick.'
    >
      <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        <RecurringRulesOverview
          rules={pageRows}
          totalDatasetCount={totalDatasetCount}
          perPage={perPage}
          currentPage={page}
        />
      </div>
    </PageContainer>
  );
}
```

---

## Consolidated findings

| Question | Answer |
|---|---|
| Is `totalDatasetCount` always `sorted.length`? | **Yes. One assignment, one source, no branches, no fallbacks, no second DB count.** |
| Can `getAllRules()` be skipped? | **No. Called unconditionally on every RSC render. No early returns, no redirects, no guards before it.** |
| Is there any code path where `totalDatasetCount > 0` and `pageRows = []` from two different sources? | **No. Both values come from the same `sorted` array in the same render invocation.** |

### What this means for the "0 von 1 Regeln" symptom

The counter (`totalDatasetCount = 1`) and the empty table (`pageRows = []`) **cannot originate
from two different queries or code paths**. They are produced from the same array in the same
synchronous block:

```ts
const sorted = [...];            // sorted.length = 1
const totalDatasetCount = sorted.length;     // = 1
const from = (page - 1) * perPage;           // = e.g. 50 when page=2, perPage=50
const pageRows = sorted.slice(from, from + perPage);  // = [] because 50 >= 1
```

The only variable that can create this divergence is `page`. When `page ≥ 2` and the
filtered dataset has fewer than `perPage` rows, `sorted.slice(from, ...)` returns `[]` while
`sorted.length` remains non-zero. This is the complete and only root cause.
