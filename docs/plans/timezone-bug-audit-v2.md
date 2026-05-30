# Timezone Bug Audit v2 — Date-Boundary Map

**Date:** 2026-05-30  
**Scope:** Read-only audit of every date-boundary computation affecting trips, dashboard stats, invoices, and SQL RPCs. No code or schema changes.  
**Sources:** Full read of canonical helpers, dashboard modules, trip filtering paths, invoice/abrechnung APIs, all Supabase migrations matching `AT TIME ZONE` / `Europe/Berlin` / `get_shift` / `scheduled_at`, and `docs/plans/timezone-master-audit.md`, `docs/trips-date-filter.md`, `AGENTS.md`.

---

## Executive verdict

The timezone remediation described in `docs/plans/timezone-master-audit.md` and shipped in Phases 2–5 (`docs/trips-date-filter.md`) has been **partially applied**:

| Area | Status |
|------|--------|
| **Fahrten list/Kanban read filter** (`trips-listing.tsx`) | ✅ Fixed — `getZonedDayBoundsIso` + Berlin YMD |
| **Trip write path** (`trip-time.ts`, cron, kanban, widgets, bulk CSV) | ✅ Largely fixed — `buildScheduledAt` / `buildScheduledAtOrNull` |
| **Driver Touren date picker** (`getDriverTrips` + `options.date`) | ✅ Fixed — `getZonedDayBoundsIso` half-open range |
| **Schichtzettel / shift reconciliation reads** | ✅ Fixed — `getZonedDayBoundsIso` + RPC `AT TIME ZONE 'Europe/Berlin'` |
| **Dashboard “Umsatz heute” / stats-utils** | ❌ **Still broken** — `isSameDay` + browser-local `new Date()` |
| **Dashboard occupancy charts** | ❌ **Still broken** — `startOfDay` / `getHours` browser-local |
| **CSV export API local duplicate helper** | ❌ **Still broken** — fake “Berlin” helper uses runtime-local `Date(y,m,d)` |
| **Driver Startseite “today”** | ❌ **Still broken** — device-local midnight (documented Phase 2b gap) |
| **Print trips ZIP** | ❌ **Still broken** — `startOfDay` / `endOfDay` on picker `Date` |
| **Invoice builder trip collection** | ⚠️ Suspect — `period_from`/`period_to` + UTC end suffix, not Berlin bounds |
| **Abrechnung KPIs** | ⚠️ Suspect — `startOfToday` / `isSameMonth` browser-local (invoice metadata, not trips) |

**Bottom line for CFO dashboard:** Do **not** reuse `stats-utils.ts` or `occupancy-utils.ts`. Use the canonical patterns in §12.

---

## PART 1 — THE CANONICAL HELPERS

### 1. `getZonedDayBoundsIso(ymd)` — full function

**File:** `src/features/trips/lib/trip-business-date.ts` lines 41–52

```typescript
export function getZonedDayBoundsIso(ymd: string): {
  startISO: string;
  endExclusiveISO: string;
} {
  const inTz = tz(getTripsBusinessTimeZone());
  const anchor = inTz(ymd);
  const dayStart = startOfDay(anchor, { in: inTz });
  const nextStart = addDays(dayStart, 1, { in: inTz });
  return {
    startISO: dayStart.toISOString(),
    endExclusiveISO: nextStart.toISOString()
  };
}
```

| Question | Answer |
|----------|--------|
| **Return shape** | Two **UTC ISO 8601 strings** with `Z` offset (via `.toISOString()`), representing half-open `[start, end)` for the given **calendar day in the business timezone**. |
| **Local ISO?** | **No.** Always UTC instants; correct for PostgREST `.gte('scheduled_at', startISO).lt('scheduled_at', endExclusiveISO)`. |
| **Timezone** | Reads **`getTripsBusinessTimeZone()`** — **not** hardcoded in this function. Default `'Europe/Berlin'`; override via env (see §4). |

### 2. `todayYmdInBusinessTz()`

**File:** `src/features/trips/lib/trip-business-date.ts` lines 34–36

```typescript
export function todayYmdInBusinessTz(): string {
  return instantToYmdInBusinessTz(Date.now());
}
```

Delegates to `instantToYmdInBusinessTz(ms)` (lines 25–31), which formats `YYYY-MM-DD` using `@date-fns/tz` + `getTripsBusinessTimeZone()`. Returns a **plain date string**, not an ISO instant.

### 3. Other date-boundary helpers

**Note:** `src/lib/date-utils.ts`, `src/lib/timezone.ts`, and `src/utils/date.ts` **do not exist** in this repository.

| Function | File | Signature | Berlin-aware? |
|----------|------|-----------|---------------|
| `getTripsBusinessTimeZone` | `trip-business-date.ts:10` | `(): string` | ✅ Default `Europe/Berlin`; env override |
| `instantToYmdInBusinessTz` | `trip-business-date.ts:25` | `(ms: number): string` | ✅ |
| `todayYmdInBusinessTz` | `trip-business-date.ts:34` | `(): string` | ✅ |
| `getZonedDayBoundsIso` | `trip-business-date.ts:41` | `(ymd: string) => { startISO, endExclusiveISO }` | ✅ |
| `ymdToPickerDate` | `trip-business-date.ts:56` | `(ymd: string): Date` | ✅ |
| `isYmdString` | `trip-business-date.ts:20` | `(value: string): boolean` | N/A (validation) |
| `buildScheduledAt` | `trip-time.ts:86` | `(ymd, hm, timeZone?): string` | ✅ Uses `getTripsBusinessTimeZone()` |
| `buildScheduledAtOrNull` | `trip-time.ts` | `(ymd, hm, timeZone?): string \| null` | ✅ |
| `parseScheduledAt` | `trip-time.ts` | `(iso, timeZone?) => { ymd, hm }` | ✅ |
| `parseScheduledAtOrFallback` | `trip-time.ts` | `(iso) => { ymd, hm } \| null` | ✅ |
| `combineYmdAndHmToIsoString` | `duplicate-trip-schedule.ts:91` | `(targetDateYmd, hm): string` | ✅ Berlin via `tz(getTripsBusinessTimeZone())` |
| `zonedDayEndInclusiveIso` | `use-upcoming-trips.ts:19` | `(ymd: string): string` | ✅ Wraps canonical `getZonedDayBoundsIso` |
| `weekStartYmd` / `weekEndYmd` / `weekDayYmds` | `driver-planning/lib/week-dates.ts` | various | ✅ |
| `weekdayKeyInBerlin` | `resolve-trip-price.ts:166` | `(scheduledAt: string): WeekdayKey` | ✅ Pricing rule day-of-week |
| **`getZonedDayBoundsIso` (duplicate)** | `app/api/trips/export/route.ts:490` | `(ymd: string)` | ❌ **Wrong** — see §PART 2 |
| **`getZonedDayBoundsIso` (duplicate)** | `app/api/trips/export/preview/route.ts:153` | `(ymd: string)` | ❌ **Wrong** — same bug |
| `getTripsForDay` | `stats-utils.ts:7` | `(trips, date: Date)` | ❌ Uses `isSameDay` |
| `getHourlyOccupancy` / `getWeeklyOccupancy` | `occupancy-utils.ts` | `(trips, …)` | ❌ Browser-local `date-fns` |
| `isToday` / `isThisWeek` | `use-unplanned-trips.ts:22,31` | `(date: Date)` | ❌ Browser-local |
| `formatDate` / `formatTime` (export) | `export/route.ts:512,523` | ISO → display | ⚠️ Uses `Date` getters (browser/server local) |

### 4. `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`

| Location | Value |
|----------|--------|
| **`env.example.txt`** | **Not documented** — variable absent from template |
| **`.env.local` / `.env.production` in repo** | **Not present** (gitignored / not committed) |
| **Default when unset** | **`'Europe/Berlin'`** — `trip-business-date.ts` line 4 (`DEFAULT_TZ`) and lines 10–17 |

`docs/trips-date-filter.md` documents the optional override; production should set it explicitly on Vercel if operations ever leave Germany.

---

## PART 2 — EVERY CALLSITE (date boundaries & “today”)

Legend: **Berlin?** = uses `Europe/Berlin` (via canonical helpers or SQL `AT TIME ZONE`). **Verdict:** ✅ Correct | ⚠️ Suspect | ❌ Bug

### 2A — `isSameDay` (entire codebase)

| File | Line | Code | Berlin? | Verdict |
|------|------|------|---------|---------|
| `stats-utils.ts` | 12 | `isSameDay(parseISO(trip.scheduled_at), date)` | No — compares in **browser local TZ** | ❌ |
| `linked-partner-callout.tsx` | 54 | `!isSameDay(partnerDate, anchorDate)` | No — **display-only** (show partner date if different day) | ⚠️ Low risk UI |

### 2B — `startOfDay` / `endOfDay`

| File | Line | Usage | Berlin? | Verdict |
|------|------|-------|---------|---------|
| `trip-business-date.ts` | 47 | `startOfDay(anchor, { in: inTz })` | ✅ | ✅ |
| `trip-time.ts` | 110 | `startOfDay(anchor, { in: inTz })` | ✅ | ✅ |
| `duplicate-trip-schedule.ts` | 69,103 | `startOfDay(inTz(ymd), { in: inTz })` | ✅ | ✅ |
| `cron/generate-recurring-trips/route.ts` | 105–107 | `startOfDay(inTz(Date.now()), { in: inTz })` | ✅ | ✅ |
| `occupancy-utils.ts` | 44–46 | `startOfDay(subDays(targetDate, …))`, `startOfDay(targetDate)`, `endOfDay(targetDate)` | No | ❌ |
| `occupancy-utils.ts` | 100–101 | `startOfDay(subDays(new Date(), …))`, `startOfDay(new Date())` | No | ❌ |
| `print-trips-button.tsx` | 58,65 | `startOfDay(date).toISOString()`, `endOfDay(date).toISOString()` | No — picker `Date` in **browser local** | ❌ |
| `pie-graph.tsx` | 57–74 | `startOfMonth(now)`, `endOfMonth(now)` via `date-fns` | No — browser-local month | ⚠️ (analytics chart) |

### 2C — `new Date()` as date boundary (not mere timestamps)

| File | Line | Usage | Berlin? | Verdict |
|------|------|-------|---------|---------|
| `overview/layout.tsx` | 54–55 | `const today = new Date(); const yesterday = subDays(today, 1)` → `getTripsForDay` | No | ❌ |
| `driver-trips.service.ts` | 34–44 | `new Date(y,m,d)` device-local → `dayStart`/`dayEnd` ISO | No — **device local**, not Berlin | ❌ |
| `use-unplanned-trips.ts` | 23–27 | `isToday`: compare `date` to `new Date()` calendar fields | No | ❌ |
| `client-trips-panel.tsx` | 42–44 | `startOfToday.setHours(0,0,0,0)` → `.gte('scheduled_at', since)` | No | ❌ |
| `export/route.ts` | 498–499 | `new Date(year, month-1, day, 0,0,0,0)` — **runtime local** (UTC on Vercel) | No — **not Berlin** despite comment | ❌ |

### 2D — `parseISO` feeding day comparison

| File | Line | Pattern | Berlin? | Verdict |
|------|------|---------|---------|---------|
| `stats-utils.ts` | 12 | `parseISO(trip.scheduled_at)` → `isSameDay` | No | ❌ |
| `occupancy-utils.ts` | 51,105 | `parseISO` → `getHours` / range compare vs `startOfDay` local | No | ❌ |
| `use-abrechnung-kpis.ts` | 74,85 | `parseISO(inv.created_at)` → due date / month | No — invoice KPIs | ⚠️ |
| `use-invoices.ts` | 63,68 | `parseISO` + `isSameMonth` | No | ⚠️ |

### 2E — `.toISOString().split('T')[0]` / `.slice(0,10)`

| File | Line | Usage | Berlin? | Verdict |
|------|------|-------|---------|---------|
| `duplicate-trips.ts` | 68 | `scheduledDate.toISOString().split('T')[0]` → UTC day for pair lookup | No — **UTC truncation** | ❌ |
| `recurring-exceptions.actions.ts` | 82 | Same pattern for paired-leg lookup | No | ❌ |
| `recurring-rules.service.ts` | 75–80 | Comment warns against; uses `todayYmdInBusinessTz()` instead | ✅ | ✅ |
| `pending-tours-widget.tsx` | 167 | Comment: fixed away from slice | ✅ uses `parseScheduledAtOrFallback` / `todayYmdInBusinessTz` | ✅ |
| `shift-time-form.tsx` | 54 | `new Date().toISOString().slice(0,10)` | No — shift form default date | ⚠️ |

### 2F — Supabase `.gte` / `.lte` / `.lt` on `scheduled_at` or `requested_date`

| File | Line | Filter | Server-side? | Berlin? | Verdict |
|------|------|--------|--------------|---------|---------|
| `trips-listing.tsx` | 238–292 | `getZonedDayBoundsIso` half-open + `requested_date` branches | ✅ | ✅ | ✅ |
| `trips.service.ts` | 63–68 | **`select('*')` — no date filter** | N/A | N/A | ❌ (loads all; dashboard filters client-side) |
| `trips.service.ts` | 214–215 | `getUpcomingTrips(startDate, endDate)` — caller supplies Berlin ISO | ✅ | ✅ when caller is `use-upcoming-trips` | ✅ |
| `trips.service.ts` | 237–240 | `getTripsForAnalytics`: `dateRange.from.toISOString()` | ✅ | ❌ if `from` is local midnight | ❌ |
| `driver-trips.service.ts` | 52–53 | `getTodaysTrips` device-local range | ✅ | ❌ | ❌ |
| `driver-trips.service.ts` | 95–96 | `getDriverTrips` + `options.date` | ✅ | ✅ | ✅ |
| `shift-reconciliations.service.ts` | 154–155 | `getTripsForShift` | ✅ | ✅ | ✅ |
| `invoice-line-items.api.ts` | 318–319 | `.gte('scheduled_at', period_from).lte(..., period_to + 'T23:59:59.999Z')` | ✅ | ❌ UTC end-of-day hack | ⚠️ |
| `duplicate-trips.ts` | 75–76 | `` `.gte(..., `${dateStr}T00:00:00`)` `` | ✅ | ❌ UTC wall | ❌ |
| `recurring-exceptions.actions.ts` | 89–90 | Same | ✅ | ❌ | ❌ |
| `print-trips-button.tsx` | 78–79 | local `start`/`end` | ✅ | ❌ | ❌ |
| `export/route.ts` | 400–415 | **Broken local** `getZonedDayBoundsIso` | ✅ | ❌ | ❌ |
| `export/preview/route.ts` | 73–89 | Same duplicate helper | ✅ | ❌ | ❌ |
| `unassigned-trips.service.ts` | 52–56 | Raw `dateFrom`/`dateTo` strings | ✅ | ⚠️ depends on UI input | ⚠️ |
| `unzugeordnete-fahrten/page.tsx` | 57–61 | Same raw pass-through | ✅ | ⚠️ | ⚠️ |
| `client-trips-panel.tsx` | 54,72 | local midnight `since` | ✅ | ❌ | ❌ |
| `use-timeless-rule-trips.ts` | 112 | `.in('requested_date', [todayYmd, tomorrowYmd])` | ✅ | ✅ (DATE column, Berlin YMD strings) | ✅ |
| `cron/generate-recurring-trips/route.ts` | 390 | `.eq('requested_date', q.requested_date)` | ✅ | ✅ (dedup key) | ✅ |
| `metrics/route.ts` | — | **No date filter** on trips | — | — | N/A |

### 2G — SQL / RPC (`scheduled_at` date extraction)

**Migrations with `AT TIME ZONE 'Europe/Berlin'`:** only `get_shift_day_summaries` (two versions):

- `supabase/migrations/20260502120000_get_shift_day_summaries.sql`
- `supabase/migrations/20260502120002_billing_type_accepts_self_payment.sql` (replaces function body)

**Full RPC SQL (current effective version):**

```sql
CREATE OR REPLACE FUNCTION public.get_shift_day_summaries(
  p_driver_id   uuid,
  p_company_id  uuid
)
RETURNS TABLE (
  shift_date          date,
  total_trips         bigint,
  self_pay_count      bigint,
  self_pay_total      numeric,
  invoice_count       bigint,
  unconfigured_count  bigint,
  is_reconciled       boolean,
  reconciled_by_name  text,
  reconciled_at       timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date AS shift_date,
    COUNT(*)::bigint AS total_trips,
    COUNT(*) FILTER (
      WHERE COALESCE(bt.accepts_self_payment, p.accepts_self_payment) = true
    )::bigint AS self_pay_count,
    COALESCE(
      SUM(COALESCE(t.manual_gross_price, t.gross_price))
        FILTER (
          WHERE COALESCE(bt.accepts_self_payment, p.accepts_self_payment) = true
        ),
      0
    ) AS self_pay_total,
    COUNT(*) FILTER (
      WHERE COALESCE(bt.accepts_self_payment, p.accepts_self_payment) = false
    )::bigint AS invoice_count,
    COUNT(*) FILTER (
      WHERE COALESCE(bt.accepts_self_payment, p.accepts_self_payment) IS NULL
    )::bigint AS unconfigured_count,
    BOOL_OR(sr.id IS NOT NULL) AS is_reconciled,
    MAX(/* reconciled_by_name expression */) AS reconciled_by_name,
    MAX(sr.confirmed_at) AS reconciled_at
  FROM public.trips t
  JOIN public.payers p ON p.id = t.payer_id
  LEFT JOIN public.billing_types bt ON bt.id = t.billing_type_id
  LEFT JOIN public.shift_reconciliations sr
    ON sr.driver_id = t.driver_id
    AND sr.company_id = t.company_id
    AND sr.date = (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date
  LEFT JOIN public.accounts a ON a.id = sr.confirmed_by
  WHERE
    t.driver_id = p_driver_id
    AND t.company_id = p_company_id
    AND t.status = 'assigned'
  GROUP BY (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date
  ORDER BY shift_date DESC;
$$;
```

**Other migrations mentioning `Europe/Berlin`:** comment-only on `driver_day_plans.plan_date` (`20260524120000_add_driver_day_plans.sql`).

**PostgreSQL views:** none in `public` schema.

**UTC truncation elsewhere:** no other RPC uses `(scheduled_at AT TIME ZONE 'UTC')`; the dominant bad pattern is **application-level** `` `${ymd}T00:00:00Z` `` or `` `.split('T')[0]` `` (see §2E).

---

## PART 3 — THE KNOWN OFFENDER

### 5. `stats-utils.ts` — was it fixed?

**No.** As of this audit, the code is unchanged from the original bug report:

```7:16:src/features/dashboard/lib/stats-utils.ts
export function getTripsForDay(trips: Trip[], date: Date): Trip[] {
  return trips.filter((trip) => {
    if (!trip.scheduled_at) return false;
    if (trip.status === 'cancelled') return false;
    try {
      return isSameDay(parseISO(trip.scheduled_at), date);
    } catch (e) {
      return false;
    }
  });
}
```

**Caller** (`overview/layout.tsx` lines 54–58):

```typescript
const today = new Date();
const yesterday = subDays(today, 1);
const tToday = getTripsForDay(trips, today);
const tYesterday = getTripsForDay(trips, yesterday);
```

**Impact:** “Fahrten heute” and “Umsatz heute” use **browser-local calendar days**, not Berlin. A admin in US Eastern or a server-rendered mismatch will disagree with Fahrten filters. Trips with `scheduled_at IS NULL` are excluded entirely.

**No fix commit** was found in these files; Phases 2–5 explicitly listed dashboard stats as **not** migrated (`timezone-master-audit.md` Finding 4; no Phase entry for `stats-utils`).

### 6. `occupancy-utils.ts` — hourly buckets

Uses **`getHours(parseISO(trip.scheduled_at))`** (line 52) after comparing against **`startOfDay(targetDate)`** / **`endOfDay(targetDate)`** (lines 44–46) — all **browser-local** `date-fns` without `{ in: tz(...) }`.

**Consumer:** `bar-graph.tsx` lines 57–57 via `useTrips()` (all trips, client-side aggregation).

**Verdict:** ❌ Berlin-incorrect for hour-of-day and “today” window.

### 7. Server-side Berlin pattern count

| Pattern | Count | Locations |
|---------|------:|-----------|
| `(scheduled_at AT TIME ZONE 'Europe/Berlin')::date` in SQL | **1 RPC** | `get_shift_day_summaries` only |
| `getZonedDayBoundsIso` (canonical) | **~15+ callsites** | trips-listing, driver Touren, shift reconciliation, upcoming trips, invoices list, cron, driver-planning, etc. |
| UTC / local midnight bugs | **~10+ callsites** | stats-utils, occupancy, print, export duplicate helper, getTodaysTrips, duplicate pair lookup, analytics, client panel |

---

## PART 4 — CLIENT vs SERVER SPLIT

### 8. Trips queries: server filter vs fetch-all + client filter

| Pattern | Files | Risk |
|---------|-------|------|
| **Fetch all trips, filter in browser** | `useTrips()` → `tripsService.getTrips()` (no date predicate); consumed by `overview/layout.tsx`, `bar-graph.tsx`, `pie-graph` (partial) | ❌ TZ + performance |
| **Server-side Berlin half-open** | `trips-listing.tsx`, `getDriverTrips`, `getUpcomingTrips`, `getTripsForShift`, `fetchTimelessRulePairs`, CSV export query body | ✅ |
| **Server-side wrong bounds** | `print-trips-button.tsx`, `export/route.ts` duplicate helper, `getTodaysTrips`, `invoice-line-items` trip fetch | ❌ / ⚠️ |
| **Client-side filter after fetch** | `use-unplanned-trips.ts` (`isToday`/`isThisWeek`), `stats-utils.getTripsForDay` | ❌ |

### 9. React Query hooks passing raw `Date` to Supabase

**No `useQuery` hook** was found that passes a raw `Date` object directly into a Supabase `.gte('scheduled_at', …)` filter.

Closest vectors:

- **`useTrips`** — no date param; loads entire table (RLS-scoped).
- **`useUpcomingTrips`** — uses `useState` + manual fetch; converts Berlin bounds to ISO strings **before** `tripsService.getUpcomingTrips(startDate, endDate)` ✅
- **`pie-graph.tsx`** — passes `{ from: Date, to: Date }` to `getTripsForAnalytics`, which calls `.toISOString()` on those Dates ❌ (local month boundaries, not Berlin).

---

## PART 5 — VERDICT & REMEDIATION MAP

### 10. Bug / suspect callsite table

| File | Line | Code / pattern | TZ correct? | Risk | Fix required |
|------|------|----------------|-------------|------|--------------|
| `stats-utils.ts` | 7–16 | `isSameDay(parseISO(...), date)` | ❌ | **High** — CFO “today” KPIs | Replace with Berlin YMD compare or server aggregation |
| `overview/layout.tsx` | 54–58 | `new Date()` + `getTripsForDay` | ❌ | **High** | Use `todayYmdInBusinessTz()` + bounds or SQL |
| `occupancy-utils.ts` | 44–52, 100–108 | `startOfDay` / `getHours` local | ❌ | Medium | Berlin zoned bucketing |
| `bar-graph.tsx` | 50–57 | `useTrips` + occupancy-utils | ❌ | Medium | Same as occupancy |
| `trips.service.ts` | 63–68 | `getTrips()` no date filter | ❌ | **High** at scale | Server-side query with Berlin bounds |
| `trips.service.ts` | 237–240 | `dateRange.from.toISOString()` | ❌ | Medium | Berlin month bounds |
| `pie-graph.tsx` | 54–81 | `startOfMonth` local → analytics | ❌ | Medium | Berlin month via `getZonedDayBoundsIso` |
| `driver-trips.service.ts` | 34–53 | `getTodaysTrips` device local | ❌ | Medium | `getZonedDayBoundsIso(todayYmdInBusinessTz())` |
| `print-trips-button.tsx` | 56–79 | `startOfDay(date)` local | ❌ | Medium | Canonical bounds for selected YMD |
| `export/route.ts` | 490–505 | **Duplicate** fake Berlin helper | ❌ | **High** — CSV date export | Import canonical `trip-business-date.ts` |
| `export/preview/route.ts` | 153–168 | Same duplicate | ❌ | **High** | Same |
| `duplicate-trips.ts` | 68–76 | UTC `split('T')[0]` + `T00:00:00` | ❌ | Low–Med | `instantToYmdInBusinessTz` + `getZonedDayBoundsIso` |
| `recurring-exceptions.actions.ts` | 82–90 | Same pair lookup | ❌ | Low–Med | Same |
| `invoice-line-items.api.ts` | 318–319 | `period_to + 'T23:59:59.999Z'` | ⚠️ | **High** for billing | Berlin half-open on service period |
| `client-trips-panel.tsx` | 42–44 | local midnight `since` | ❌ | Low | Berlin today start |
| `use-unplanned-trips.ts` | 22–110 | `isToday` / `isThisWeek` local | ❌ | Medium | Berlin YMD on trip date fields |
| `unassigned-trips.service.ts` | 52–56 | opaque ISO strings from UI | ⚠️ | Med | Document + enforce YMD→bounds at boundary |
| `use-abrechnung-kpis.ts` | 64–85 | `startOfToday` / `isSameMonth` | ⚠️ | Low (invoices) | Berlin month if CFO merges invoice + trip KPIs |
| `getInvoiceRevenueTotal` | 116–124 | No date filter | N/A | Low | Not a TZ bug; all-time sum |
| `linked-partner-callout.tsx` | 54 | `isSameDay` display | ⚠️ | Very low | Optional: Berlin YMD compare |
| `@bar_stats/page.tsx` | 4–7 | Mock delay + `BarGraph` | — | Inherits bar-graph bugs | Fix bar-graph chain |
| `@area_stats/page.tsx` | 4–6 | Mock + `AreaGraph` (template data) | — | N/A | Not production analytics |

**Fixed since `timezone-master-audit.md` (was broken, now ✅):**

| File | Lines | Fix |
|------|-------|-----|
| `driver-trips.service.ts` | 90–96 | `getZonedDayBoundsIso(options.date)` |
| `cron/generate-recurring-trips/route.ts` | 102–108, 58–65, 543 | Berlin window + `buildScheduledAt` |
| `timeless-rule-trips-widget.tsx` | 93+ | `buildScheduledAtOrNull` |
| `pending-tours-widget.tsx` | 205–208 | `buildScheduledAtOrNull` |
| `use-timeless-rule-trips.ts` | 226–233 | Berlin today/tomorrow YMDs |
| `use-upcoming-trips.ts` | 35–63 | `getZonedDayBoundsIso` |
| `trips-listing.tsx` | 225–294 | Full Berlin read filter |
| `departure-schedule.ts` | — | `buildScheduledAt` (Phase 3A) |

### 11. Has the master audit fix been fully applied?

**No — partially applied.**

Phases 2–5 (`docs/trips-date-filter.md`) successfully fixed the **authoritative Fahrten read path**, **cron materialization**, **most write paths**, **driver Touren date filter**, **shift reconciliation**, and **several dashboard widgets** (timeless/pending assignment writes).

**Remaining stragglers** called out in the master audit that are **still present**:

1. Dashboard **stats-utils** / **overview layout** (Finding 4 — revenue KPIs)
2. **Occupancy** / bar chart chain
3. **getTodaysTrips** (Finding 1 — documented deferral)
4. **CSV export duplicate helper** (regression — worse than master audit; comment claims Berlin but implementation is runtime-local)
5. **Print trips** export
6. **Invoice builder trip queries** (UTC end suffix)
7. **Paired-trip day lookup** in duplicate/cancel flows

The master audit document itself was written **before** Phases 2–5; it remains **directionally correct** but **out of date** on fixed items (driver Touren, cron, widgets). Do not treat it as a current fix checklist without this v2 addendum.

### 12. Canonical patterns for CFO dashboard

#### SQL (Postgres) — trip on Berlin calendar day

Use for aggregations, RPCs, and server-side reports:

```sql
-- Half-open filter for one Berlin day (preferred for timestamptz indexes)
-- Bind :start_iso and :end_exclusive_iso from application layer, OR:

SELECT *
FROM public.trips t
WHERE t.company_id = :company_id
  AND t.scheduled_at >= (:ymd::date::timestamp AT TIME ZONE 'Europe/Berlin')
  AND t.scheduled_at <  ((:ymd::date + interval '1 day')::timestamp AT TIME ZONE 'Europe/Berlin')
  AND t.status <> 'cancelled';

-- Calendar day column for GROUP BY time series:
SELECT
  (t.scheduled_at AT TIME ZONE 'Europe/Berlin')::date AS trip_date,
  COUNT(*) AS trip_count,
  SUM(t.net_price) AS net_revenue
FROM public.trips t
WHERE t.company_id = :company_id
GROUP BY 1
ORDER BY 1;
```

**Include date-only trips:** also union or OR-branch on `requested_date = :ymd::date` when `scheduled_at IS NULL` (mirror `trips-listing.tsx` logic).

**Hardcode vs env:** SQL RPCs today hardcode `'Europe/Berlin'`. Application code should use `getTripsBusinessTimeZone()` so a future env change does not desync JS filters from SQL unless migrations update RPCs too.

#### TypeScript — server or client query bounds

**Always import from one module** — never copy helpers into API routes:

```typescript
import {
  getZonedDayBoundsIso,
  todayYmdInBusinessTz,
  instantToYmdInBusinessTz
} from '@/features/trips/lib/trip-business-date';

// Single Berlin calendar day
const ymd = todayYmdInBusinessTz(); // or user-selected 'YYYY-MM-DD'
const { startISO, endExclusiveISO } = getZonedDayBoundsIso(ymd);

const { data, error } = await supabase
  .from('trips')
  .select('id, scheduled_at, net_price, status, payer_id')
  .eq('company_id', companyId)
  .gte('scheduled_at', startISO)
  .lt('scheduled_at', endExclusiveISO)
  .neq('status', 'cancelled');

// Client-side "is this trip on Berlin day?" (when you already have rows):
function tripYmdInBerlin(scheduledAtIso: string): string {
  return instantToYmdInBusinessTz(new Date(scheduledAtIso).getTime());
}

const isBerlinToday =
  tripYmdInBerlin(trip.scheduled_at) === todayYmdInBusinessTz();
```

**Write `scheduled_at`:**

```typescript
import { buildScheduledAt } from '@/features/trips/lib/trip-time';

const scheduled_at = buildScheduledAt('2026-06-15', '10:30');
// → UTC ISO storing 10:30 Europe/Berlin (or configured business TZ)
```

**Never for persisted times or day boundaries:**

- `isSameDay(parseISO(...), new Date())`
- `new Date(y, m, d).toISOString()` without `@date-fns/tz`
- `` `${ymd}T00:00:00.000Z` ``
- `scheduled_at.toISOString().split('T')[0]` for filtering
- Duplicate `getZonedDayBoundsIso` in API routes using `new Date(year, month-1, day)`

---

## Appendix — Files read

**Core:** `trip-business-date.ts`, `trip-time.ts`, `duplicate-trip-schedule.ts`  
**Dashboard:** `stats-utils.ts`, `occupancy-utils.ts`, `overview/layout.tsx`, `@bar_stats/*`, `@area_stats/*`, `bar-graph.tsx`, `pie-graph.tsx`, `pending-tours-widget.tsx`, `timeless-rule-trips-widget.tsx`, `use-unplanned-trips.ts`, `use-timeless-rule-trips.ts`  
**Trips:** `trips.service.ts`, `use-trips.ts`, `trips-listing.tsx`, `print-trips-button.tsx`, `use-upcoming-trips.ts`, `duplicate-trips.ts`, `recurring-exceptions.actions.ts`  
**API:** `app/api/trips/metrics/route.ts`, `app/api/trips/export/route.ts`, `app/api/trips/export/preview/route.ts`, `app/api/cron/generate-recurring-trips/route.ts`  
**Driver:** `driver-trips.service.ts`  
**Invoices / Abrechnung:** `invoices.api.ts`, `invoice-line-items.api.ts`, `use-invoice-revenue-total.ts`, `use-abrechnung-kpis.ts`, `abrechnung-overview/*`  
**SQL:** `20260502120000_get_shift_day_summaries.sql`, `20260502120002_billing_type_accepts_self_payment.sql`  
**Docs:** `timezone-master-audit.md`, `trips-date-filter.md`, `AGENTS.md` (Trips time system), `env.example.txt`

---

*End of audit. No code, schema, or data was modified.*


Verdict: Partially resolved — not fully fixed
Phases 2–5 fixed the Fahrten read path, cron, most write paths, driver Touren date filter, and shift reconciliation. Several paths flagged in timezone-master-audit.md are still broken.

Canonical helpers (Part 1)
getZonedDayBoundsIso returns UTC ISO strings (…Z) for half-open [start, end) in getTripsBusinessTimeZone() (default Europe/Berlin, override NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE).
todayYmdInBusinessTz() → YYYY-MM-DD in that same timezone.
src/lib/date-utils.ts, timezone.ts, utils/date.ts do not exist.
NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE is not in env.example.txt; default is Europe/Berlin when unset.
Known offender (Part 3)
No fix was applied to stats-utils.ts:


stats-utils.ts
Lines 7-12
export function getTripsForDay(trips: Trip[], date: Date): Trip[] {
  return trips.filter((trip) => {
    if (!trip.scheduled_at) return false;
    if (trip.status === 'cancelled') return false;
    try {
      return isSameDay(parseISO(trip.scheduled_at), date);
overview/layout.tsx lines 54–58 still passes new Date() — browser-local, not Berlin.

occupancy-utils.ts still uses browser-local startOfDay / getHours(parseISO(...)).

SQL Berlin pattern (Part 3, Q7)
Only get_shift_day_summaries uses (scheduled_at AT TIME ZONE 'Europe/Berlin')::date. Full RPC body is copied in the doc. No other views/RPCs use that pattern.

Critical stragglers for CFO work
Issue	Files
Today revenue KPI
stats-utils.ts, overview/layout.tsx
Fetch-all + client filter
use-trips.ts / trips.service.getTrips()
Fake Berlin helper
app/api/trips/export/route.ts:490, export/preview/route.ts:153 (uses new Date(y,m,d) = runtime local, not @date-fns/tz)
Occupancy charts
occupancy-utils.ts → bar-graph.tsx
Analytics month filter
pie-graph.tsx → getTripsForAnalytics with local startOfMonth
CFO dashboard canonical patterns (Part 5, Q12)
The doc includes copy-paste SQL (AT TIME ZONE 'Europe/Berlin' half-open bounds + GROUP BY) and TypeScript (getZonedDayBoundsIso + .gte/.lt on scheduled_at, instantToYmdInBusinessTz for client-side day checks). Do not reuse stats-utils or occupancy-utils