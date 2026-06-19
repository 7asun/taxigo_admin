# Tabellenansicht exportieren — Prefill Not Applied (Audit)

**Symptom:** With active table filters, **Tabellenansicht exportieren** preview shows **+1000 rows** (broad/unfiltered feel) instead of the filtered subset. Date range appears as **last ~30 days** instead of **today** or the active `scheduled_at` range.

**Scope:** Read-only audit of prefill hook → dialog open effect → preview API → `applyExportFilters`.

**Date:** 2026-06-19

---

## Executive summary

The export pipeline **does call** `useExportFilterPrefill()` and passes `prefillFilters` into both `setFilters` and `loadPreviewCount(prefillFilters)`. That wiring is **not** the primary bug.

The dominant failure is **`parseDateRangeFromScheduledAt` does not parse `YYYY-MM-DD` `scheduled_at` values**, which is the **canonical single-day format** written by the Fahrten filters bar (`todayYmdInBusinessTz()`). When parsing fails, dates fall back to **`createDefaultExportFilters()` → last 30 calendar days**, which easily yields **hundreds or 1000+ trips** while the table shows **today only**.

Secondary gaps widen the table vs export mismatch:

| Dimension | List (`trips-listing.tsx`) | Export prefill / API |
|-----------|---------------------------|----------------------|
| `scheduled_at` YMD (`2026-06-19`) | Parsed via `isYmdString` | **Not parsed** → 30-day fallback |
| Today backlog (`scheduled_at` + `requested_date` both null) | Extra OR branch when day === today | **Missing** in `applyExportFilters` |
| `invoice_status` | RPC pre-filter | **Not mapped** at all |
| `search` | `ilike` on name/addresses | **Not mapped** |
| `fremdfirma:all` assignee | `not('fremdfirma_id', 'is', null)` | Maps to `assigneeFilter: null` |

---

## Section A — Prefill hook

### 1. Where is `useExportFilterPrefill` called?

**File:** [`csv-export-dialog.tsx`](../src/features/trips/components/csv-export/csv-export-dialog.tsx)

```51:51:src/features/trips/components/csv-export/csv-export-dialog.tsx
  const prefillFilters = useExportFilterPrefill();
```

- Called at **component top level** (every render), **not** inside the open `useEffect`.
- The hook uses `useSearchParams()` + `useMemo` internally.

### 2. Default values when NO URL filters are active

When all mapped params are absent, `useExportFilterPrefill` spreads `createDefaultExportFilters()` then overwrites only fields it can read from the URL.

**From [`createDefaultExportFilters()`](../src/features/trips/types/csv-export.types.ts) (lines 102–115):**

| Field | Default value |
|-------|----------------|
| `payerIds` | `[]` |
| `billingVariantIds` | `[]` |
| `assigneeFilter` | `null` |
| `statusFilter` | `[]` |
| `ktsFilter` | `[]` |
| `dateFrom` | **Today minus 30 days** (`from.setDate(from.getDate() - 30)`, formatted `YYYY-MM-DD` via **runtime local** `Date`) |
| `dateTo` | **Today** (runtime local `Date`) |

Hook overrides when URL params exist (lines 93–101):

- `payerIds` ← `parseUuidList(payer_id)` → `[]` if absent  
- `billingVariantIds` ← `parseUuidList(billing_variant_id)` → `[]` if absent  
- `assigneeFilter` ← `parseAssigneeFromUrl(driver_id)` → `null` if absent / `all`  
- `statusFilter` ← `parseStatusList(status)` → `[]` if absent or `'all'`  
- `ktsFilter` ← `parseKtsFilterParam(kts_filter)` → `[]` if absent  
- `dateFrom` / `dateTo` ← `parseDateRangeFromScheduledAt(scheduled_at)` or defaults above  

### 3. When `scheduled_at` is absent — `parseDateRangeFromScheduledAt` fallback

**File:** [`use-export-filter-prefill.ts`](../src/features/trips/hooks/use-export-filter-prefill.ts) lines 53–77

```ts
function parseDateRangeFromScheduledAt(scheduledAt: string | null): {
  dateFrom?: string;
  dateTo?: string;
} {
  if (!scheduledAt) return {};  // ← empty object

  const parts = scheduledAt.split(',');
  if (parts.length === 2) {
    // expects two numeric epoch ms: "fromMs,toMs"
    ...
  }

  const ts = Number(scheduledAt);
  if (!Number.isNaN(ts)) {
    const ymd = instantToYmdInBusinessTz(ts);
    return { dateFrom: ymd, dateTo: ymd };
  }

  return {};  // ← YMD strings fall through here
}
```

**When `scheduled_at` is absent:**

1. `parseDateRangeFromScheduledAt` returns `{}`.
2. Hook sets `dateFrom: dateRange.dateFrom ?? defaults.dateFrom` → **last 30 days**.
3. Hook sets `dateTo: dateRange.dateTo ?? defaults.dateTo` → **today**.

**It does not fall back to today-only.** It falls back to the **30-day window** from `createDefaultExportFilters()`.

**When `scheduled_at` is a YMD string (e.g. `2026-06-19`):**

- `Number('2026-06-19')` → `NaN` → returns `{}` → **same 30-day fallback**.

This contradicts the list query, which treats YMD as a single day ([`trips-listing.tsx`](../src/features/trips/components/trips-listing.tsx) lines 283–301 via `isYmdString(raw)`).

### 4. Is `prefillFilters` stale when the open effect runs?

**Definition (line 51):**

```ts
const prefillFilters = useExportFilterPrefill();
```

**Hook implementation (lines 87–103):** `useMemo(..., [searchParams])` — recomputes when Next.js `searchParams` changes.

**Open effect (lines 115–136):**

```ts
React.useEffect(() => {
  if (!open) return;
  ...
  setFilters(prefillFilters);
  ...
  void loadPreviewCount(prefillFilters);
}, [open, prefillFilters, mode]);
```

**Assessment:**

- On the render where `open` becomes `true`, `prefillFilters` is the **current** memo output for that render’s `searchParams`.
- It is **not** read inside the hook only when the dialog opens; it is a live top-level value.
- **Not a stale-closure bug** in the usual sense: the effect dependency array includes `prefillFilters`.
- **Caveat:** If `searchParams` and visible table state ever diverge (e.g. filter bar updated local state before URL `router.replace` completes), prefill could lag by one navigation frame. The **systematic** date bug is format parsing, not stale closure.

---

## Section B — `loadPreviewCount`

### 5. Full current implementation (post table-view changes)

**File:** [`csv-export-dialog.tsx`](../src/features/trips/components/csv-export/csv-export-dialog.tsx) lines 86–113

```ts
const loadPreviewCount = async (filtersOverride?: ExportFilters) => {
  setIsLoadingPreview(true);
  try {
    const activeFilters = filtersOverride ?? filters;
    const params = buildExportPreviewSearchParams(activeFilters);
    const response = await fetch(
      `/api/trips/export/preview?${params.toString()}`,
      { method: 'GET' }
    );
    ...
  } finally {
    setIsLoadingPreview(false);
  }
};
```

| Check | Result |
|-------|--------|
| Accepts `filtersOverride?: ExportFilters`? | **Yes** |
| Uses `filtersOverride ?? filters`? | **Yes** (line 89) |
| Calls `buildExportPreviewSearchParams`? | **Yes** (line 90) |

**`buildExportPreviewSearchParams` serializes** ([`export-query.ts`](../src/features/trips/lib/export-query.ts) lines 183–215):

| Query param | When set |
|-------------|----------|
| `date_from` | **Always** (`filters.dateFrom`) |
| `date_to` | **Always** (`filters.dateTo`) |
| `payer_ids` | Only if `payerIds.length > 0` (comma-joined UUIDs) |
| `billing_variant_ids` | Only if `billingVariantIds.length > 0` |
| `status` | Only if `statusFilter.length > 0` |
| `kts_filter` | Only if `ktsFilter.length > 0` |
| `assignee_type` | `unassigned` \| `driver` \| `fremdfirma` when assignee set |
| `assignee_id` | UUID when type is `driver` or `fremdfirma` |

Empty dimensions are **omitted** from the query string (not sent as empty strings).

### 6. Same object for `setFilters` and `loadPreviewCount`?

Table-view open effect (lines 121–135):

```ts
setFilters(prefillFilters);
...
void loadPreviewCount(prefillFilters);
```

- **Same reference:** both use the identical `prefillFilters` object from the current render.
- **No transformation** between them.
- If prefill is wrong (e.g. 30-day dates), **both** React state and the preview fetch receive the same wrong filters.

---

## Section C — API route

### 7. Full param parsing in `GET /api/trips/export/preview`

**File:** [`preview/route.ts`](../src/app/api/trips/export/preview/route.ts)

Parsing delegated to `parseExportFiltersFromPreviewParams(searchParams)` ([`export-query.ts`](../src/features/trips/lib/export-query.ts) lines 140–179).

| Filter | URL key(s) | Absent / empty behaviour |
|--------|------------|---------------------------|
| **Date** | `date_from`, `date_to` | **Required.** Missing either → throws `'date_from und date_to sind erforderlich.'` → **400** |
| **Payer** | `payer_ids` (CSV) | Absent → `[]` → no payer `IN` clause |
| **Billing variant** | `billing_variant_ids` (CSV) | Absent → `[]` → no billing `IN` clause |
| **Status** | `status` (CSV) | Absent → `[]` → no status clause |
| **KTS** | `kts_filter` (CSV) | Absent → `[]` → no KTS clause |
| **Assignee** | `assignee_type`, optional `assignee_id` | No `assignee_type` → `null` → no assignee clause. `assignee_id` without type → **throws** |

Route then:

```ts
sampleQuery = applyExportFilters(sampleQuery, filters);
countQuery = applyExportFilters(countQuery, filters);
```

### 8. Does `applyExportFilters` always apply a date filter?

**Yes.** There is **no** “skip if default” branch. Every call applies a date OR clause first (lines 278–285):

```ts
const { startISO: fromISO } = getZonedDayBoundsIso(filters.dateFrom);
const { endExclusiveISO: toISO } = getZonedDayBoundsIso(filters.dateTo);

let next = q.or(
  `and(scheduled_at.gte.${fromISO},scheduled_at.lt.${toISO}),and(scheduled_at.is.null,requested_date.gte.${filters.dateFrom},requested_date.lte.${filters.dateTo})`
);
```

Uses **business TZ** day bounds (`getZonedDayBoundsIso`), not runtime-local midnight.

So “default” 30-day `dateFrom`/`dateTo` still constrains to **that 30-day window** — not unbounded — but that window is **much wider than today** and explains **+1000** counts.

### 9. All-empty filters + default 30-day dates — resulting query

Input: `payerIds=[]`, `billingVariantIds=[]`, `assigneeFilter=null`, `statusFilter=[]`, `ktsFilter=[]`, `dateFrom`/`dateTo` = 30-day defaults.

**Beyond `company_id`**, `applyExportFilters` adds **only**:

1. **Date OR** (scheduled window OR unscheduled with `requested_date` in `[dateFrom, dateTo]`)

**No** payer, billing, status, KTS, or assignee predicates.

Conceptual shape:

```text
SELECT ... FROM trips
WHERE company_id = :companyId
  AND (
    (scheduled_at >= :fromISO AND scheduled_at < :toISO)
    OR (
      scheduled_at IS NULL
      AND requested_date >= :dateFrom
      AND requested_date <= :dateTo
    )
  )
```

This can return **all company trips in the last 30 days** (scheduled + unscheduled with matching `requested_date`) — consistent with a **+1000** preview count when the table shows **today only**.

---

## Section D — Date behaviour

### 10. Does the URL contain `scheduled_at` when the table shows “today only”?

**Normal steady state: yes — as a YMD string.**

[`searchparams.ts`](../src/lib/searchparams.ts) line 30:

```ts
scheduled_at: parseAsString, // for date filtering
```

No server default in nuqs cache; param is optional.

[`trips-filters-bar.tsx`](../src/features/trips/components/trips-filters-bar.tsx) lines 155–164 — **one-time mount effect:**

```ts
if (searchParams.get('scheduled_at')) return;
params.set('scheduled_at', todayYmdInBusinessTz());  // e.g. "2026-06-19"
router.replace(next, { scroll: false });
```

So after the filters bar mounts, the URL typically becomes:

```text
?scheduled_at=2026-06-19&page=1
```

**Not** applied server-side without a URL param in the listing: [`trips-listing.tsx`](../src/features/trips/components/trips-listing.tsx) wraps date logic in `if (scheduledAt) { ... }` (line 234). If `scheduled_at` were truly absent during an RSC fetch, **no date filter** would run (brief race before client `router.replace`).

**Date picker ranges** use epoch ms ([`trips-filters-bar.tsx`](../src/features/trips/components/trips-filters-bar.tsx) lines 400–404):

```ts
scheduled_at: `${from},${to}`  // numeric ms — prefill CAN parse this
```

**Single-day jumps / default today** use **YMD** ([`docs/trips-date-filter.md`](../trips-date-filter.md) line 57): canonical `YYYY-MM-DD`; legacy ms still accepted **on the list**, not in export prefill.

### 11. Table “today only” vs export prefill when no date is set — mismatch?

**Yes — systematic mismatch.**

| Source | Effective date scope when user sees “today” |
|--------|---------------------------------------------|
| **Table (steady state)** | URL `scheduled_at=YYYY-MM-DD` (today in business TZ) → list filters **one day** (+ today backlog branch) |
| **Export prefill** | `parseDateRangeFromScheduledAt('2026-06-19')` → `{}` → **`dateFrom` = today−30, `dateTo` = today** |

Even when the URL **has** today’s YMD, export prefill **ignores it** and uses the 30-day default.

Additional list-only filters **not** in export prefill:

- `invoice_status` → RPC trip-id set  
- `search` → text `ilike`  
- `fremdfirma:all` → all external assignees  

So the table can show a **small filtered subset** while export preview queries a **30-day, partially mapped** superset → **+1000 rows** symptom.

---

## Root-cause ranking

1. **`parseDateRangeFromScheduledAt` missing YMD handling** — primary cause of wrong date window (30 days vs today).  
2. **Export prefill omits `invoice_status` and `search`** — table filters invisible to export.  
3. **`fremdfirma:all` not mapped to `ExportAssigneeFilter`** — assignee filter dropped.  
4. **`applyExportFilters` missing today backlog OR branch** — even with correct single-day dates, undated backlog rows shown on today’s board may be excluded from export (secondary count skew).  
5. **`createDefaultExportFilters` uses runtime local `Date`** — minor TZ skew vs business TZ for fallback dates.

**Not root cause:** stale `prefillFilters` closure; `loadPreviewCount` ignoring override; preview route ignoring query params (dates are always sent and parsed).

---

## Recommended fix directions (informational — no code in this audit)

1. Align `parseDateRangeFromScheduledAt` with list parsing: accept `isYmdString` single day; accept `fromMs,toMs` range; default absent param to **`todayYmdInBusinessTz()` for both `dateFrom` and `dateTo`**, not 30 days, when mirroring table-view export.  
2. Map remaining list URL params (`invoice_status`, `search`, `fremdfirma:all`) or show explicit “not exported” warning (deferred in product plan).  
3. Optionally align `applyExportFilters` date OR with list backlog branch for single-day + today.

---

## Files referenced

| Path | Role |
|------|------|
| [`use-export-filter-prefill.ts`](../src/features/trips/hooks/use-export-filter-prefill.ts) | URL → `ExportFilters` |
| [`csv-export-dialog.tsx`](../src/features/trips/components/csv-export/csv-export-dialog.tsx) | Open effect, `loadPreviewCount` |
| [`export-query.ts`](../src/features/trips/lib/export-query.ts) | Param build/parse, `applyExportFilters` |
| [`preview/route.ts`](../src/app/api/trips/export/preview/route.ts) | Preview GET handler |
| [`searchparams.ts`](../src/lib/searchparams.ts) | nuqs param definitions |
| [`trips-filters-bar.tsx`](../src/features/trips/components/trips-filters-bar.tsx) | Default today URL, date picker ms format |
| [`trips-listing.tsx`](../src/features/trips/components/trips-listing.tsx) | Server list query (reference behaviour) |
| [`csv-export.types.ts`](../src/features/trips/types/csv-export.types.ts) | `createDefaultExportFilters` |
