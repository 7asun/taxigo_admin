# v4 Pre-Implementation Audit — Timezone Implementation + `requested_date` Backfill Safety

**Date:** 2026-06-23  
**Scope:** Read-only — no code or data changes  
**DB project:** `etwluibddvljuhkxjkxs` (Supabase)  
**Context:** Before v4 data repair (NULL `requested_date` backfill + cron dedup), confirm Berlin TZ consistency and backfill SQL safety.

---

## Executive summary

| Question | Verdict |
|----------|---------|
| Is `scheduled_at` stored as UTC `timestamptz`? | **Yes** |
| Is Berlin the canonical business timezone? | **Yes** — `getTripsBusinessTimeZone()` → default `Europe/Berlin` |
| Is `DATE(scheduled_at AT TIME ZONE 'Europe/Berlin')` the correct backfill? | **Yes** — Berlin civil date is the service date |
| Safe to run the proposed backfill UPDATE? | **Yes** — for current production data (9 rows, zero cross-midnight among them) |
| Rows with both `scheduled_at` AND `requested_date` NULL? | **0** — no rule-trip rows in that state |
| Write path DST-safe? | **Yes** — `@date-fns/tz` via `buildScheduledAt` / `instantToYmdInBusinessTz` |
| Display path DST-safe everywhere? | **Partial gap** — several UI surfaces use `date-fns` `format(new Date(iso))` (browser local TZ), not Berlin helpers |

---

## 1. Canonical timezone constant

### Source of truth

**File:** `src/features/trips/lib/trip-business-date.ts`

```typescript
const DEFAULT_TZ = 'Europe/Berlin';

export function getTripsBusinessTimeZone(): string {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE) {
    return process.env.NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE;
  }
  return DEFAULT_TZ;
}
```

- **Canonical accessor:** `getTripsBusinessTimeZone()`
- **Default:** `Europe/Berlin` (hardcoded as `DEFAULT_TZ`)
- **Override:** `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE` (optional env; documented in `docs/trips-date-filter.md`; **not** in `env.example.txt`)
- **Library:** `@date-fns/tz` (`tz()` wrapper) for all business-calendar math

There is **no** `src/lib/date-utils.ts`. Shared date helpers live in:

| Module | Role |
|--------|------|
| `trip-business-date.ts` | YMD derivation, day bounds, picker dates |
| `trip-time.ts` | `buildScheduledAt` / `parseScheduledAt` (UTC ISO ↔ Berlin wall clock) |
| `recurring-trip-schedule.ts` | Cron/resync wrapper `scheduledIsoFromBerlinCalendarAndClock` |

### C1 — All `Europe/Berlin` / TZ constant locations in `src/`

| File | Symbol / usage | Pattern |
|------|----------------|---------|
| `trip-business-date.ts` | `DEFAULT_TZ` | Hardcoded default inside canonical module |
| `invoices/lib/resolve-trip-price.ts` | `BERLIN_TZ` | Redundant local constant; falls back with `getTripsBusinessTimeZone() \|\| BERLIN_TZ` |
| `invoices/components/invoice-pdf/lib/invoice-pdf-format.ts` | inline `timeZone: 'Europe/Berlin'` | Hardcoded in `Intl.DateTimeFormat` |
| `payers/.../step2-rule-config.tsx` | UI label only | Display string, not logic |

**Every other trips feature** imports `getTripsBusinessTimeZone()`, `todayYmdInBusinessTz()`, or `instantToYmdInBusinessTz()` rather than hardcoding the string.

**v4 cleanup task:** Extract a single exported `BUSINESS_TIMEZONE` (or re-export `DEFAULT_TZ`) from `trip-business-date.ts`; replace `BERLIN_TZ` in `resolve-trip-price.ts` and the invoice PDF formatter.

### C2 — `todayYmdInBusinessTz()`

- **Returns:** `string` — `YYYY-MM-DD` (not a JS `Date`)
- **Implementation:** `instantToYmdInBusinessTz(Date.now())` → formats instant in `getTripsBusinessTimeZone()`
- **TZ source:** env override or hardcoded `Europe/Berlin` default

---

## 2. `scheduled_at` storage format

### TZ1 — Sample rows

```sql
SELECT id, client_name, scheduled_at,
       scheduled_at AT TIME ZONE 'Europe/Berlin' AS berlin_local,
       pg_typeof(scheduled_at) AS column_type,
       requested_date
FROM trips WHERE scheduled_at IS NOT NULL LIMIT 5;
```

| Field | Result |
|-------|--------|
| **Column type** | `timestamp with time zone` (`timestamptz`) |
| **Storage** | UTC with offset suffix (`+00`) |
| **Berlin conversion** | Correct CEST offset (+2h in June samples) |

**Sample (June 2026, CEST):**

| client | scheduled_at (UTC) | berlin_local | requested_date |
|--------|-------------------|--------------|----------------|
| Paulina | `2026-06-02 13:45:00+00` | `2026-06-02 15:45:00` | `2026-06-02` |
| Ingrid Schultz | `2026-06-15 05:15:00+00` | `2026-06-15 07:15:00` | `2026-06-15` |
| Volker Burghardt | `2026-03-16 08:52:00+00` | `2026-03-16 09:52:00` | `2026-03-16` (CET +1) |

**Answers:**

- **(a)** Column is **`timestamptz`** — Postgres stores UTC internally; `AT TIME ZONE 'Europe/Berlin'` correctly yields Berlin wall time.
- **(b)** Berlin local times match expected dispatcher-facing clocks (CEST +2 in summer, CET +1 in winter sample).

### TZ4 — DB server timezone

```sql
SELECT current_setting('timezone');
```

| Setting | Value |
|---------|-------|
| `timezone` | **`UTC`** |

Expected for Supabase. `DATE(scheduled_at)` therefore equals the **UTC calendar date**, which is why cross-midnight detection must use `AT TIME ZONE 'Europe/Berlin'`, not bare `DATE(scheduled_at)`.

### C3 — How `buildScheduledAt` constructs UTC

**File:** `src/features/trips/lib/trip-time.ts`

1. Parse `ymd` (`YYYY-MM-DD`) and `hm` (`HH:mm` or `HH:mm:ss`)
2. Resolve zone: `timeZone ?? getTripsBusinessTimeZone()`
3. `@date-fns/tz`: `inTz(ymd)` → `startOfDay` → `setHours` / `setMinutes` in that zone
4. Return `new Date(ms).toISOString()` (UTC ISO, ms zeroed)

**Method:** `@date-fns/tz` — **not** manual offset math, **not** `new Date(y,m,d,h,m).toISOString()`.

**DST:** Documented and tested in `trip-time.test.ts`:

- Spring forward (2026-03-29): `01:30` → `2026-03-29T00:30:00.000Z`
- Fall back (2026-10-25): ambiguous `02:30` → `@date-fns/tz` oracle `2026-10-25T01:30:00.000Z`

**Inverse read:** `parseScheduledAt(iso)` uses the same zone for `{ ymd, hm }`.

### `requested_date` column type

```sql
SELECT pg_typeof(requested_date) FROM trips WHERE requested_date IS NOT NULL LIMIT 1;
```

→ **`date`** (PostgreSQL `date`, not `text`). App code treats it as `YYYY-MM-DD` string over the wire; SQL comparisons should cast consistently (`requested_date::text` or compare `date` to `date`).

---

## 3. Berlin-date derivation safety

### Intended semantics

- **`scheduled_at`:** absolute UTC instant (when the vehicle should depart, if timed)
- **`requested_date`:** Berlin **civil calendar day** for scheduling/filtering/dedup — independent of whether a clock exists

The cron materialiser, duplicate flows, and detail-sheet save path all set `requested_date` from **Berlin YMD**, not UTC date.

### C4 — Recurring trip generator

**File:** `src/lib/recurring-trip-generator.ts`  
**Cron route:** `src/app/api/cron/generate-recurring-trips/route.ts` — calls `generateRecurringTrips()` with **no timezone parameter**; all date logic is server-side via business-TZ helpers.

Flow per RRule occurrence:

1. `dateStr = instantToYmdInBusinessTz(dateUTC.getTime())` — Berlin calendar day from occurrence instant
2. `buildTripPayload(..., dateStr, ...)` sets `requested_date: dateStr` (line 314)
3. Timed legs: `scheduledIsoFromBerlinCalendarAndClock(dateStr, time)` → `buildScheduledAt(dateStr, time)`
4. Timeless outbound: `scheduled_at: null`, `requested_date: dateStr` still set
5. Dedup key: `(client_id, rule_id, requested_date, leg)`

**Conclusion:** `requested_date` is derived from the **rule's Berlin occurrence date**, not UTC date and not passed in from the cron HTTP caller.

### C5 — UTC-date anti-patterns for `requested_date`

| Pattern | Found in write paths? |
|---------|----------------------|
| `.toISOString().slice(0, 10)` for `requested_date` | **No** — only mentioned in comments (`use-pending-assignments.ts`, `pending-assignment-item.tsx`) explaining why it must **not** be used |
| `new Date().toDateString()` | **No** |
| `instantToYmdInBusinessTz` / `todayYmdInBusinessTz` / explicit `dateStr` from generator | **Yes** — all write paths checked |

**Write paths confirmed Berlin-safe:**

- `recurring-trip-generator.ts` — `dateStr` from `instantToYmdInBusinessTz`
- `departure-schedule.ts` — `requested_date = ymd` (form/CSV calendar day, then `buildScheduledAt`)
- `build-trip-details-patch.ts` — `instantToYmdInBusinessTz` when clearing time
- `derive-duplicate-schedules.ts` / `duplicate-trip-schedule.ts` — `instantToYmdInBusinessTz`
- `create-trip-form.tsx` — explicit Berlin YMD from form

---

## 4. Cross-midnight risk rows

### TZ2 — Legacy NULL `requested_date` on rule trips (with `scheduled_at`)

```sql
-- Aggregate
SELECT midnight_risk, COUNT(*) FROM (
  SELECT CASE
    WHEN DATE(scheduled_at AT TIME ZONE 'Europe/Berlin') = DATE(scheduled_at)
    THEN 'same-day' ELSE 'CROSS-MIDNIGHT — dates differ'
  END AS midnight_risk
  FROM trips
  WHERE rule_id IS NOT NULL AND requested_date IS NULL AND scheduled_at IS NOT NULL
) sub GROUP BY midnight_risk;
```

| midnight_risk | count |
|---------------|-------|
| same-day | **9** |
| CROSS-MIDNIGHT | **0** |

**Total legacy backfill candidates:** 9 rows (all Ingrid Schultz duplicates + Kira outbound + Ulrike Klöver-Stallmann — per v4 cron dedup audit).

| id (prefix) | client | scheduled_at UTC | berlin_local | backfill value |
|-------------|--------|------------------|--------------|----------------|
| `7e0da8aa` | Ingrid Schultz | 2026-06-23 05:30 UTC | 07:30 Berlin | `2026-06-23` |
| `54d92673` | Kira Herbers | 2026-06-23 09:00 UTC | 11:00 Berlin | `2026-06-23` |
| `334d9281` | Ulrike Klöver-Stallmann | 2026-06-23 07:30 UTC | 09:30 Berlin | `2026-06-23` |
| … | Ingrid (6 more) | 2026-06-24 – 2026-06-26 | morning/afternoon | matching Berlin dates |

**Answers:**

- **(a)** **0** rows with `CROSS-MIDNIGHT` among backfill candidates.
- **(b)** When Berlin ≠ UTC date, **Berlin date is correct** (service day). Example from wider fleet (non-rule trips):

| client | scheduled_at UTC | berlin_local | berlin_date | utc_date |
|--------|------------------|--------------|-------------|----------|
| Magret Janssen | `2026-06-13 22:04 UTC` | `2026-06-14 00:04` | **2026-06-14** | 2026-06-13 |
| Leon | `2026-04-03 23:10 UTC` | `2026-04-04 01:10` | **2026-04-04** | 2026-04-03 |

Using UTC date would assign the **previous** calendar day — wrong for dispatch.

- **(c)** `DATE(scheduled_at AT TIME ZONE 'Europe/Berlin')` is the **correct** backfill expression. There is no safer alternative when `scheduled_at` exists.

**Fleet-wide cross-midnight (all trips):** 5 rows total — none are rule-trip backfill candidates; all are manual/non-rule trips in the 22:00–23:59 UTC window (CEST).

### TZ3 — Existing `requested_date` vs Berlin date consistency

```sql
SELECT COUNT(*) FROM trips
WHERE rule_id IS NOT NULL
  AND requested_date IS NOT NULL
  AND scheduled_at IS NOT NULL
  AND requested_date::text <> DATE(scheduled_at AT TIME ZONE 'Europe/Berlin')::text;
```

| Metric | Value |
|--------|-------|
| Mismatch count (all rule trips with both fields) | **1** |
| Recent 30 rows sampled | All **consistent** |

**Single mismatch:**

| id | client | scheduled_at UTC | berlin_date | requested_date |
|----|--------|------------------|-------------|----------------|
| `535bdef9` | Oliver Staudacher | `2026-06-10 02:20 UTC` | `2026-06-10` | **`2026-06-08`** |

This is **not** a systematic UTC-vs-Berlin off-by-one (would be exactly 1 day). It is a **2-day gap** — likely manual reschedule / exception / data entry, not timezone encoding. Berlin and UTC dates agree for this row (`2026-06-10`).

**Conclusion:** Existing populated `requested_date` values overwhelmingly match Berlin derivation; no evidence of fleet-wide UTC-date write bug on rule trips.

---

## 5. DST safety assessment

### Write / storage / filter path — **DST-safe**

| Layer | Mechanism | DST handling |
|-------|-----------|--------------|
| Persist `scheduled_at` | `buildScheduledAt` + `@date-fns/tz` | Tested spring/fall 2026 |
| Read day windows | `getZonedDayBoundsIso(ymd)` | Half-open `[start, end)` in business TZ |
| YMD from instant | `instantToYmdInBusinessTz(ms)` | Same TZ module |
| Cron RRule | `DTSTART;TZID=${businessTz}:...` + `instantToYmdInBusinessTz` on occurrences | TZID-aware RRule |
| Detail sheet **save** | `buildScheduledAt`, `parseScheduledAt`, `instantToYmdInBusinessTz` | Berlin-intent preserved |
| Detail sheet **time edit** | `applyTimeToScheduledDate` → `parseScheduledAt` + `buildScheduledAt` | Berlin-intent preserved |

### Display path — **partial gap (not blocking backfill)**

**File:** `trip-detail-sheet.tsx` (client component)

Initial display of date/time uses **browser local TZ**, not Berlin helpers:

```typescript
setTimeDraft(format(new Date(trip.scheduled_at), 'HH:mm'));
setDateYmdDraft(format(new Date(trip.scheduled_at), 'yyyy-MM-dd'));
const currentDateYmd = format(new Date(trip.scheduled_at), 'yyyy-MM-dd');
```

`date-fns` `format()` without `{ in: tz(...) }` uses the **runtime local timezone**.

- **Dispatchers in Germany:** Usually correct (browser TZ = Berlin).
- **Admin from UTC/other TZ:** Could show wrong date/time for trips near midnight Berlin (the 5 cross-midnight rows).
- **Saves still correct:** Patch builder uses `parseScheduledAt` / `buildScheduledAt`.

Same pattern elsewhere: kanban drag preview, trip-row, share-utils, print lists, pending-assignment display — all `format(new Date(scheduled_at), ...)`.

**v4 follow-up (UI, not backfill):** Replace display `format(new Date(iso))` with `parseScheduledAt(iso).ymd` / `.hm` or `format(inTz(ms), ..., { in: inTz })` in trip-detail-sheet and high-traffic surfaces.

### DST transition windows

| Transition | Write-path behavior |
|------------|---------------------|
| CET → CEST (last Sunday March) | `01:30` pre-gap works; gap hours (02:00–02:59 nonexistent) would throw via `buildScheduledAt` validation |
| CEST → CET (last Sunday October) | Ambiguous hour resolved to **later** CET branch per `@date-fns/tz` oracle (documented in tests) |

No code path uses fixed `+1`/`+2` offset math that would break on transition days.

---

## 6. Backfill SQL verdict

### Proposed SQL

```sql
UPDATE trips
SET requested_date =
  DATE(scheduled_at AT TIME ZONE 'Europe/Berlin')::text
WHERE rule_id IS NOT NULL
  AND requested_date IS NULL
  AND scheduled_at IS NOT NULL;
```

### Verdict: **YES — safe to run**

**Why:**

1. **Semantic match:** App code defines `requested_date` as Berlin civil calendar day; the expression is the Postgres equivalent of `instantToYmdInBusinessTz`.
2. **Current data:** All 9 candidate rows are `same-day` (Berlin date = UTC date for those instants); backfill values match what the cron would have written (`2026-06-23` … `2026-06-26`).
3. **Future-proof:** Even if later candidates appear in the 22:00–23:59 UTC window, Berlin derivation is strictly **more correct** than UTC date or leaving NULL.
4. **DB timezone UTC:** `AT TIME ZONE 'Europe/Berlin'` is explicit — not affected by session `timezone = UTC`.
5. **Column type:** `requested_date` is `date`; assigning `DATE(...)::text` coerces cleanly (prefer `DATE(...)` without `::text` for clarity — equivalent effect).

**Pre-backfill checklist:**

- [ ] Run `SELECT` preview (same WHERE clause) and confirm row count still 9
- [ ] Run backfill in a transaction; verify zero `CROSS-MIDNIGHT` mismatches post-update
- [ ] Proceed with v4 dedup index (`requested_date` must be NOT NULL for unique constraint — this backfill unblocks that)

**What this does NOT fix:**

- Oliver Staudacher mismatch (`requested_date` = `2026-06-08` vs Berlin `2026-06-10`) — out of scope; needs manual review
- Duplicate Ingrid rows — backfill gives them a dedup key but **dedup merge** is still required separately

---

## 7. Rows with both fields NULL — strategy

### TZ5

```sql
SELECT COUNT(*) FROM trips
WHERE rule_id IS NOT NULL
  AND requested_date IS NULL
  AND scheduled_at IS NULL;
```

| Count | **0** |

**No rule-trip rows** currently have both fields NULL. Timeless rule legs in production always have at least `requested_date` set by the materialiser (or are among the 9 NULL `requested_date` rows that **do** have `scheduled_at`).

**If such rows appear in future:**

| Strategy | When |
|----------|------|
| Derive from rule + ingestion metadata | If `ingestion_source = 'recurring_rule'` and exception/occurrence date is recoverable from audit/logs |
| Re-run materialiser for date window | If rule still active — generator sets `requested_date: dateStr` even when `scheduled_at` is null (timeless outbound) |
| Leave NULL + special dedup | Last resort — v4 dedup must treat `(rule_id, client_id, leg, NULL requested_date)` as a distinct bucket (current bug source for Ingrid) |

**Recommendation:** After backfill, add DB constraint or partial unique index only on rows where `requested_date IS NOT NULL`; keep explicit NULL handling in materialiser until timeless legacy is fully eliminated.

---

## 8. Hardcoded TZ locations (if any)

| Location | Hardcoded? | Action |
|----------|------------|--------|
| `trip-business-date.ts` `DEFAULT_TZ` | Yes — **canonical default** | Keep; optionally export as `BUSINESS_TIMEZONE` |
| `getTripsBusinessTimeZone()` | No — env-aware | **Use everywhere for logic** |
| `resolve-trip-price.ts` `BERLIN_TZ` | Yes — redundant | v4: import canonical constant |
| `invoice-pdf-format.ts` | Yes — `Intl` option | v4: use `getTripsBusinessTimeZone()` |
| `step2-rule-config.tsx` | Label only | OK |
| SQL backfill / audits | `'Europe/Berlin'` literal | OK for one-off SQL; must match `DEFAULT_TZ` |
| `recurring-trip-generator.ts` RRule | `TZID=${businessTz}` | Uses accessor — good |

**Cron route:** Does not pass timezone; delegates to generator — **correct**.

**Trip detail sheet display:** Does not use hardcoded Berlin — uses **browser local** via `date-fns` (see §5 gap).

---

## Appendix — Code question quick reference

| ID | Answer |
|----|--------|
| **C1** | Canonical: `getTripsBusinessTimeZone()` in `trip-business-date.ts`. Three hardcoded `'Europe/Berlin'` strings elsewhere (see §8). |
| **C2** | `todayYmdInBusinessTz()` → `YYYY-MM-DD` string; TZ from env or `DEFAULT_TZ`. |
| **C3** | `@date-fns/tz` + `setHours`/`setMinutes`; DST tested; throws on invalid dates. |
| **C4** | Generator computes Berlin `dateStr` from RRule occurrence via `instantToYmdInBusinessTz`; sets `requested_date: dateStr` in payload. |
| **C5** | No write path uses UTC slice for `requested_date`; comments explicitly warn against it. |

---

## Senior diagnosis (summary)

1. **Backfill expression safe?** **Yes** — `DATE(scheduled_at AT TIME ZONE 'Europe/Berlin')` matches app semantics; UTC date would be wrong for ~22:00–23:59 UTC trips (5 exist fleet-wide, 0 among current backfill set).

2. **Both NULL rows?** **0 today.** Timeless legs should get `requested_date` from materialiser; dedup must still handle NULL as special case until eliminated.

3. **DST-safe end-to-end?** **Writes/filters/cron: yes.** **Display: partial** — trip-detail-sheet and several formatters use browser local TZ, not Berlin helpers.

4. **Single constant?** **Mostly** — one accessor, three redundant hardcodes flagged for v4 cleanup.

5. **Run backfill?** **Yes** — 9 rows, all unambiguous; unblocks dedup unique index; aligns NULL-key duplicates (Ingrid/Kira) with cron dedup key `(client_id, rule_id, requested_date, leg)`.

---

*Audit complete. No code or data changes made.*
