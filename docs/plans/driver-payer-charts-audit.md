# Driver & Payer Charts — Data Layer Audit

**Date:** 2026-05-30  
**Scope:** Read-only audit of `useControllingData`, controlling service/utils, `DriverTable`, and breakdown row shape — to assess feasibility of driver revenue charts and payer current-vs-previous bar charts.  
**No code or schema changes were made.**

---

## 1. `useControllingData` Hook

**File:** `src/features/controlling/hooks/use-controlling-data.ts`

### Queries returned (exact variable names → RPC)

| Variable | Service function | Supabase RPC |
|---|---|---|
| `operational` | `fetchControllingOperational(period)` | `get_controlling_operational` |
| `operationalPrevious` | `fetchControllingOperational(previousPeriod)` | `get_controlling_operational` |
| `breakdown` | `fetchControllingBreakdown(period)` | `get_controlling_breakdown` |
| `heatmap` | `fetchControllingHeatmap(period)` | `get_controlling_heatmap` |
| `invoiceKpis` | `fetchControllingInvoiceKpis(period)` | `get_controlling_invoice_kpis` |
| `monthlyRevenue` | `fetchControllingMonthlyRevenue()` | `get_controlling_monthly_revenue` |

Also returned: aggregate flags `isLoading` and `isError` (derived from the period-scoped queries above; `operationalPrevious` is **not** included in either flag).

### `breakdownPrevious` — absent

There is **no** `breakdownPrevious` query. Only `operationalPrevious` implements a prior-period fetch today.

### Previous-period shift helper — exists

**Function:** `buildPreviousControllingPeriod(period: ControllingPeriod)` in `controlling-utils.ts` (lines 153–170).

**Behaviour:** Shifts **any** `ControllingPeriod` back by the same **inclusive day count**:

1. `dayCount = differenceInCalendarDays(dateTo, dateFrom) + 1` (Berlin TZ via `@date-fns/tz`)
2. `prevTo = dateFrom − 1 day`
3. `prevFrom = prevTo − (dayCount − 1) days`

Returns a new `ControllingPeriod` with:

- Same `key` as the input period (e.g. `this_month` stays `this_month`, not rewritten to `last_month`)
- Updated `dateFrom` / `dateTo` for the shifted window
- Label: `Vorperiode (DD.MM.YYYY – DD.MM.YYYY)`

**Examples (conceptual):**

| Selected period | Shift result |
|---|---|
| `this_month` (e.g. 1–31 Mar) | Previous 31-day window ending day before 1 Mar (≈ Feb) |
| `this_week` (Mon–Sun) | Previous 7-day window ending day before week start |
| `today` (1 day) | Yesterday |
| `custom` (arbitrary range) | Same-length range immediately preceding `dateFrom` |
| `last_month` (picker preset) | Window of equal length ending day before that month’s `dateFrom` — **not** “the month before last month” as a calendar preset |

There is **no** separate `buildPreviousPeriod` name; `buildPreviousControllingPeriod` is the canonical helper.

**Note:** `buildControllingPeriod` does **not** define a `last_week` preset. `ControllingPeriodKey` is: `today | this_week | this_month | last_month | custom`.

### `staleTime`

All six queries use:

```ts
staleTime: CONTROLLING_STALE_TIME_MS  // 5 * 60 * 1000 = 300_000 ms (5 minutes)
```

Defined in `controlling-utils.ts` line 31.

---

## 2. Controlling Service

**File:** `src/features/controlling/api/controlling.service.ts`

### Breakdown fetch function

| Property | Value |
|---|---|
| **Name** | `fetchControllingBreakdown` |
| **Signature** | `(period: ControllingPeriod) => Promise<ControllingBreakdownRow[]>` |
| **RPC** | `get_controlling_breakdown` with `{ p_company_id, p_date_from: period.dateFrom, p_date_to: period.dateTo }` |

Accepts a **`ControllingPeriod` object** (not raw date strings). Dates are read from `period.dateFrom` and `period.dateTo`.

No separate “previous breakdown” service function exists — the same function would be called with `buildPreviousControllingPeriod(period)`.

---

## 3. `DriverTable` — Current Data Shape

**File:** `src/features/controlling/components/DriverTable.tsx`

### Props interface

```ts
export interface DriverTableProps {
  breakdown: UseQueryResult<ControllingBreakdownRow[]>;
}
```

Single prop: `breakdown` (current period only).

### Data flow

- Receives raw **`breakdown.data`** (`ControllingBreakdownRow[]`) from the hook.
- **Client-side aggregation** via local `aggregateDrivers()` — groups by `driver_id` (null → key `__unassigned__`).
- Does **not** receive pre-aggregated driver rows from the RPC.

**`aggregateDrivers` roll-up:**

- Sums: `trip_count`, `revenue_net`, `total_km`, `wheelchair_trips`
- Takes `active_days` from the **first** row seen for that driver (RPC returns driver-level `active_days` repeated on every slice for the same driver)

### Columns displayed

| Column | Source |
|---|---|
| Fahrer | `driver_name` (or “Nicht zugewiesen”) |
| Fahrten | `trip_count` |
| Netto-Umsatz | `revenue_net` |
| Gesamt-km | `total_km` (hidden `< md`) |
| Ø €/km | computed `revenue_net / total_km` (hidden `< md`) |
| Auslastungsindex | `formatTripsPerDay(trip_count, active_days)` (hidden `< lg`) |
| Rollstuhl | `wheelchair_trips` (hidden `< lg`) |

Sortable on all seven logical keys (`SortKey` type).

**Page wiring:** `page.tsx` passes `breakdown={breakdown}` only — no previous-period breakdown.

---

## 4. Breakdown Data — Driver Aggregation Feasibility

### `ControllingBreakdownRow` fields — confirmed

From `controlling.types.ts`:

- `driver_id: string | null` ✓
- `driver_name: string | null` ✓
- Plus payer/billing slice fields, `trip_count`, `revenue_net`, `revenue_gross`, `total_km`, `active_days`, `wheelchair_trips`

### RPC row granularity

**One RPC row ≠ one driver.**  
`get_controlling_breakdown` `GROUP BY`:

`payer_id, billing_type_id, billing_variant_id, driver_id` (+ name columns, `active_days`)

So each row is a **driver × payer × billing_type × billing_variant** slice. Multiple rows share the same `driver_id` when that driver has trips under different payers or billing paths.

### Existing driver aggregation utility

| Location | Function | Scope |
|---|---|---|
| `controlling-utils.ts` | `aggregateOperationalRows` | Daily operational rows only — **not** breakdown |
| `DriverTable.tsx` | `aggregateDrivers` (local) | Breakdown → `ControllingDriverSummary[]` |

**No shared utility** in `controlling-utils.ts` for driver roll-up from breakdown rows.

For a **driver revenue chart**, options:

1. **Reuse/extract** `aggregateDrivers` from `DriverTable.tsx` into a shared util or hook, or
2. **New `useMemo`** in the chart component duplicating the same `Map<driver_id, …>` sum logic

Minimal duplication risk: extract `aggregateDrivers` to `controlling-utils.ts` or a small `controlling-aggregations.ts` if both table and chart need it.

**Revenue per driver:** `SUM(revenue_net) GROUP BY driver_id` — exactly what `aggregateDrivers` already does client-side. No new RPC required.

---

## 5. Payer Chart — Previous Period Feasibility

### Requirement

Current vs previous period bars per payer need:

- Current: `breakdown` (exists)
- Previous: second `get_controlling_breakdown` call with shifted dates

### Current state

| Question | Answer |
|---|---|
| Does `useControllingData` have a second breakdown query? | **No** |
| Pattern for prior period elsewhere? | **`operationalPrevious`**: same service + same RPC, `queryFn: () => fetchControllingOperational(previousPeriod)` where `previousPeriod = buildPreviousControllingPeriod(period)` |
| Separate “previous breakdown” RPC? | **No** — reuse `get_controlling_breakdown` |

### `buildControllingPeriod` presets (relevant keys)

**`last_month`:** Returns `ControllingPeriod` with `key: 'last_month'`, Berlin calendar bounds for the full previous calendar month, `label: 'Letzter Monat'`.

**`last_week`:** **Not a preset.** Only `this_week` exists for week selection.

**Arbitrary previous period for comparisons:** Use `buildPreviousControllingPeriod(selectedPeriod)` — works for any active picker period including `custom`, `this_month`, `this_week`, `today`, and even when the user picked `last_month` as the *current* view (shift goes back one equal-length window from that month’s start).

### Payer-level aggregation for charts

`PayerBreakdown.tsx` already has `buildPayerTree()` rolling breakdown rows up to payer level (sums `revenue_net`, `revenue_gross`, etc.). A payer bar chart would either:

- Reuse similar payer roll-up from `breakdown.data` and `breakdownPrevious.data`, or
- Share/extract `buildPayerTree` logic

No RPC change needed for payer totals — only a second query + client-side merge by `payer_id`.

---

## 6. Senior Recommendation — Minimal Safe Change for `breakdownPrevious`

### Verdict

**No new utility required.** `buildPreviousControllingPeriod` already exists and is used by `operationalPrevious`. Mirror that pattern exactly.

### Minimal change to `use-controlling-data.ts`

1. Reuse existing `const previousPeriod = buildPreviousControllingPeriod(period)` (already computed line 25).

2. Add query:

```ts
const breakdownPrevious = useQuery({
  queryKey: controllingKeys.breakdownPrevious(period),
  queryFn: () => fetchControllingBreakdown(previousPeriod),
  staleTime: CONTROLLING_STALE_TIME_MS
});
```

3. Return `breakdownPrevious` from the hook object.

4. **Optional:** Include `breakdownPrevious.isLoading` in section-level loading if the payer chart needs a skeleton (do **not** add to global `isLoading` unless product wants whole-page wait — `operationalPrevious` is intentionally excluded today).

### Query key (add to `src/query/keys/controlling.ts`)

Follow `operationalPrevious` naming:

```ts
breakdownPrevious: (period: ControllingPeriod) =>
  [
    'controlling',
    'breakdown-previous',
    period.dateFrom,
    period.dateTo
  ] as const,
```

Key encodes the **selected** period’s bounds (same as `operationalPrevious`), not the shifted dates — cache invalidates when the user changes the picker; fetch uses `previousPeriod` inside `queryFn`.

### Service

Call existing **`fetchControllingBreakdown(previousPeriod)`** — no new service function.

### Downstream (out of scope for this audit, but noted)

- **Payer chart:** `useMemo` merging current `buildPayerTree(breakdown.data)` with previous tree keyed by `payer_id`.
- **Driver chart:** Extract or reuse `aggregateDrivers` for current + previous; join on `driver_id`.
- **`page.tsx`:** Pass `breakdownPrevious` into new chart components when built.

### Risk notes

- **Double fetch cost:** One extra breakdown RPC per period change — acceptable; same cost model as existing `operationalPrevious`.
- **Row volume:** Breakdown can be large (driver × payer × billing slices); two parallel fetches match established KPI delta pattern.
- **`active_days` on breakdown:** Driver-level field repeated per slice — aggregation must not sum `active_days` (DriverTable already takes first row only).

---

## Summary Table

| Capability | Status |
|---|---|
| Previous period date math | ✅ `buildPreviousControllingPeriod` |
| Previous operational data | ✅ `operationalPrevious` |
| Previous breakdown data | ❌ Missing — add `breakdownPrevious` |
| Breakdown service | ✅ `fetchControllingBreakdown(period)` |
| Driver roll-up from breakdown | ✅ Local `aggregateDrivers` in DriverTable only |
| Payer roll-up from breakdown | ✅ `buildPayerTree` in PayerBreakdown |
| New RPC / migration for charts | ❌ Not required |

---

## Implementation Status: complete

**Date implemented:** 2026-05-30

### Files changed

| File | Change |
|---|---|
| `src/query/keys/controlling.ts` | Added `breakdownPrevious` query key |
| `src/features/controlling/hooks/use-controlling-data.ts` | Added `breakdownPrevious` query (excluded from global `isLoading`) |
| `src/features/controlling/lib/controlling-utils.ts` | Extracted `aggregateDrivers`; added `aggregatePayers` |
| `src/features/controlling/types/controlling.types.ts` | Added `ControllingPayerSummary` |
| `src/features/controlling/components/DriverRevenueChart.tsx` | New horizontal bar chart (current period driver revenue) |
| `src/features/controlling/components/PayerComparisonChart.tsx` | New grouped vertical bar chart (current vs previous payer revenue) |
| `src/features/controlling/components/DriverTable.tsx` | Imports `aggregateDrivers` from utils; local copy removed |
| `src/app/dashboard/controlling/page.tsx` | Renders both charts; passes `breakdownPrevious` |

### Deferred (unchanged)

- Scatter plot
- Driver-level previous period comparison
- Chart interactivity linking to table rows

### No changes made to

- RPCs, migrations, or `database.types.ts`
- `buildPayerTree` in `PayerBreakdown.tsx`
