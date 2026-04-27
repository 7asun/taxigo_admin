# Timezone master audit — TaxiGo `scheduled_at` architecture

**Purpose:** Consolidate code evidence, prior audit findings, and senior-level fix strategy. **No code or schema changes** in this document.

**Authoritative read path (Fahrten):** `getZonedDayBoundsIso` in `src/features/trips/lib/trip-business-date.ts` (lines 41–52) — half-open `[start, end)` in **`getTripsBusinessTimeZone()`** (default `Europe/Berlin`, override `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`).

---

## Section 1 — Confirm or correct the five findings

### Finding 1 — Driver portal uses UTC midnight for a **date** filter (partially confirmed; one path corrected)

**Confirmed for `getDriverTrips` when `options.date` is set:**

```88:92:src/features/driver-portal/api/driver-trips.service.ts
  if (options?.date) {
    const dayStart = `${options.date}T00:00:00.000Z`;
    const dayEnd = `${options.date}T23:59:59.999Z`;
    query = query.gte('scheduled_at', dayStart).lte('scheduled_at', dayEnd);
```

This bounds the **UTC** calendar day, not the Berlin calendar day. A trip at `2026-04-03T23:10:00+00:00` falls in **2026-04-04 01:10** in Berlin (CEST); the filter for `date=2026-04-03` incorrectly includes it; for `date=2026-04-04` it may **exclude** it. The described “Leon” symptom is **consistent** with this code.

**Correction — `getTodaysTrips` is different** (driver home / “today”):

```32:42:src/features/driver-portal/api/driver-trips.service.ts
  const now = new Date();
  const dayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).toISOString();
  const dayEnd = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  ).toISOString();
```

Here the range is built from the **device/browser local** calendar (midnight → next midnight), then converted to ISO. That is **not** the same as the `T00:00:00.000Z` bug. A driver in Germany using “today” may see **correct** inclusion; **Touren** with a **picked** `YYYY-MM-DD` uses the **broken** UTC window.

**Verdict:** Finding 1 is **accurate for `getDriverTrips` + `options.date`**; do **not** generalize to `getTodaysTrips` without qualification.

---

### Finding 2 — Cron: UTC date window + UTC time encoding (confirmed in code)

**`todayLocal` / window (variable name is misleading on UTC server):**

```90:91:src/app/api/cron/generate-recurring-trips/route.ts
    const todayLocal = startOfDay(new Date());
    const windowEndLocal = endOfDay(addDays(todayLocal, 14));
```

`date-fns` `startOfDay` / `endOfDay` use the **runtime’s local timezone**. On Vercel Node without `TZ=Europe/Berlin`, that is **UTC**, not Berlin “today”.

**Occurrence date string from RRule:**

```477:478:src/app/api/cron/generate-recurring-trips/route.ts
      for (const dateUTC of occurrencesUTC) {
        const dateStr = dateUTC.toISOString().split('T')[0];
```

This is the **UTC** `YYYY-MM-DD` of the occurrence instant, not `instantToYmdInBusinessTz`.

**Time encoding:**

```51:53:src/app/api/cron/generate-recurring-trips/route.ts
function toScheduledIso(dateStr: string, timeHhMmSs: string): string {
  const t = clockToHhMmSs(timeHhMmSs);
  return new Date(`${dateStr}T${t}`).toISOString();
}
```

On a **UTC** runtime, the naïve datetime is interpreted as **UTC local wall time**, not Berlin.

**Verdict:** Finding 2 matches the code. SQL anecdotes (Oliver Staudacher) are **operational**; they are not contradicted by the code, but **two rows / same `rule_id` / same `requested_date`** are **not** ipso facto a duplicate (see Section 2b).

---

### Finding 3 — Write path: browser-local `Date` → `toISOString()` (confirmed; risk as stated)

**`departure-schedule.ts`:**

```45:58:src/features/trips/lib/departure-schedule.ts
  const full = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    hours,
    minutes,
    0,
    0
  );
  ...
  return { scheduled_at: full.toISOString(), requested_date };
```

**`apply-time-to-scheduled.ts`:** `setHours` / `new Date(y, mo-1, d)` — **browser local**.

**Reschedule:** There is **no** `parse-local-ymd-hm.ts` file; parsing lives **inline** in `trip-reschedule-dialog.tsx` as `parseLocalYmdHm` (lines 46–66), building `new Date(y, m - 1, d, hh, mm, 0, 0)`.

**Verdict:** Finding 3 is **correct**. The **exception** called out in context — `duplicate-trip-schedule.ts` using `@date-fns/tz` + `getTripsBusinessTimeZone()` — is **accurate** (see Section 3).

---

### Finding 4 — Dashboard widgets: mixed UTC date + local `set` (confirmed)

**Timeless rule widget:**

```84:96:src/features/dashboard/components/timeless-rule-trips-widget.tsx
      for (const e of edits) {
        const [hours, minutes] = e.time.split(':');
        const scheduledDate = set(new Date(pair.requested_date), {
          hours: parseInt(hours, 10),
          minutes: parseInt(minutes, 10),
          seconds: 0,
          milliseconds: 0
        });
...
        await tripsService.updateTrip(e.trip.id, {
          scheduled_at: scheduledDate.toISOString()
        });
```

`new Date(pair.requested_date)` with `requested_date` like `YYYY-MM-DD` is parsed as **UTC midnight** in ECMAScript; `date-fns` `set` then applies **local** hours — **mixed construction**.

**Pending tours widget:**

```190:199:src/features/dashboard/components/pending-tours-widget.tsx
      const [hours, minutes] = time.split(':');
      const scheduledDate = set(new Date(dateStr), {
        hours: parseInt(hours, 10),
        minutes: parseInt(minutes, 10),
        seconds: 0,
        milliseconds: 0
      });

      const updatePayload: Parameters<typeof tripsService.updateTrip>[1] = {
        scheduled_at: scheduledDate.toISOString(),
```

Same pattern when `dateStr` is a plain `YYYY-MM-DD` string.

**Verdict:** Finding 4 is **correct** and is a **real** bug class for non-UTC browser environments (and still subtle in Berlin if midnight interpretation shifts the date).

---

### Finding 5 — Kunna Höpken: UX / multi-view “today” (cannot confirm in code; not contradicted)

The codebase does **not** encode passenger names. The **reported** resolution (single row, correct `requested_date`, confusion from **another** surface such as upcoming / overview) is a **product operations** conclusion. Technically, `useUpcomingTrips` uses **local** `startOfDay` / `endOfDay` (`src/features/trips/hooks/use-upcoming-trips.ts`), which **differs** from Fahrten’s Berlin URL default (`TripsFiltersBar` + `todayYmdInBusinessTz`). That **supports** the thesis that different screens can show overlapping trips without duplicate DB rows.

**Verdict:** Finding 5 is **plausible** and **consistent** with mixed date logic across features; it is **not** verifiable from SQL in this repo alone.

---

## Section 2 — Data integrity analysis

### 2a — `toScheduledIso`: “correct” vs “buggy” UTC for Berlin 10:00

Assume **business intent:** passenger pickup at **10:00** local on calendar day **D** in **Europe/Berlin**.

**Correct stored instant (what Fahrten + duplicate pattern aim for):**

- **CEST (summer, UTC+2):** 10:00 Berlin = **08:00 UTC** → e.g. `2026-06-15T08:00:00.000Z` (with `requested_date` / Fahrten day = 2026-06-15 in Berlin).
- **CET (winter, UTC+1):** 10:00 Berlin = **09:00 UTC** → e.g. `2026-01-15T09:00:00.000Z`.

**Buggy cron output (current `toScheduledIso` on UTC runtime):** interprets `10:00:00` as **UTC** wall time:

- Summer: `2026-06-15T10:00:00.000Z` — **2 hours** later in UTC than the correct value.
- Winter: `2026-01-15T10:00:00.000Z` — **1 hour** later than the correct value.

**Displayed local time in Berlin (what dispatch sees in Fahrten / formatters):**

- From buggy summer row: `10:00 UTC` → **12:00** CEST — **+2 hours** vs intended 10:00.
- From buggy winter row: `10:00 UTC` → **11:00** CET — **+1 hour** vs intended 10:00.

So: **every** cron-generated timed leg (under UTC mis-encoding) has wall-clock error of **+2h in CEST** and **+1h in CET** relative to the rule’s `pickup_time` / `return_time` **if** those strings were meant as Berlin local (product assumption).

---

### 2b — Oliver Staudacher: two rows, same `rule_id`, times 02:20Z and 04:30Z

**Expected structure:** `generate-recurring-trips` generates **up to two trips per occurrence** when the rule has a return leg: **outbound** (`link_type` null or outbound) and **return** (`link_type = 'return'`), same `requested_date`, same `rule_id`, **different** `pickup_time` vs `return_time` from `recurring_rules`.

Schema (`src/types/database.types.ts` lines 724–735):

- `pickup_time`, `return_time` — separate clock strings.
- `return_mode`, `return_trip` — control whether / how return is generated.

So **two rows** with the same `rule_id` and `requested_date` and **different** `scheduled_at` are **often a Hin/Rück pair**, not a mistaken duplicate. **Distinguish** with `trips.link_type` and `linked_trip_id` after the cron’s link update.

**Verdict:** Treat as **two legs of one rule** until proven otherwise; use `link_type` + times vs `pickup_time`/`return_time` to validate.

---

### 2c — Wrong time vs wrong **day** on Fahrten

Fahrten buckets by **Berlin** `[start, end)` (`getZonedDayBoundsIso`).

For a **typical daytime** pickup, both the **correct** and **buggy** UTC instants fall on the **same Berlin calendar day** as `requested_date` — dispatch sees the trip on the **right day** but at the **wrong clock** (Section 2a).

**Wrong day** becomes likely when:

- Combined with **UTC `dateStr`** from `toISOString().split('T')[0]` (occurrence on **UTC** date vs Berlin date around **21:00–23:59** Berlin / **DST** boundaries), or  
- Intended times near **midnight** where a +1h/+2h shift pushes the instant across `getZonedDayBoundsIso` boundaries.

**Verdict:** Primary harm is **wrong o’clock** on the **right** day; **day** errors are **edge-heavy** (midnight + DST + RRule UTC date).

---

### 2d — SQL scope for backfill / review (cron rows whose stored instant ≠ Berlin combination)

Postgres can express “expected” local wall time as a `timestamptz` via:

`(timestamp without time zone AT TIME ZONE 'Europe/Berlin')`

**Heuristic scope — all timed legs materialized from rules (review set):**

```sql
SELECT
  t.id,
  t.company_id,
  t.client_id,
  t.rule_id,
  t.link_type,
  t.requested_date,
  t.scheduled_at,
  t.ingestion_source,
  r.pickup_time,
  r.return_time
FROM public.trips t
INNER JOIN public.recurring_rules r ON r.id = t.rule_id
WHERE t.ingestion_source = 'recurring_rule'
  AND t.scheduled_at IS NOT NULL
  AND t.rule_id IS NOT NULL;
```

**Mismatch detection in Postgres (pattern):** interpret `requested_date` + rule clock as a **naïve local** wall time in `Europe/Berlin`, convert to `timestamptz`, compare to `scheduled_at`.

Example (PostgreSQL; normalize `rule_clock` to `HH:MM:SS` in a subquery or use `to_char` — your stored `pickup_time` / `return_time` shapes may need `lpad`):

```sql
SELECT
  t.id,
  t.scheduled_at,
  t.requested_date,
  t.link_type,
  r.pickup_time,
  r.return_time,
  (
    (t.requested_date::text || ' ' ||
      CASE
        WHEN t.link_type = 'return' THEN coalesce(r.return_time, '00:00:00')
        ELSE coalesce(r.pickup_time, '00:00:00')
      END
    )::timestamp AT TIME ZONE 'Europe/Berlin'
  ) AS expected_scheduled_at
FROM public.trips t
INNER JOIN public.recurring_rules r ON r.id = t.rule_id
WHERE t.ingestion_source = 'recurring_rule'
  AND t.scheduled_at IS NOT NULL
  AND t.rule_id IS NOT NULL
  AND (
    CASE
      WHEN t.link_type = 'return' THEN r.return_time
      ELSE r.pickup_time
    END
  ) IS NOT NULL
  AND t.scheduled_at IS DISTINCT FROM (
    (t.requested_date::text || ' ' ||
      CASE
        WHEN t.link_type = 'return' THEN coalesce(r.return_time, '00:00:00')
        ELSE coalesce(r.pickup_time, '00:00:00')
      END
    )::timestamp AT TIME ZONE 'Europe/Berlin'
  );
```

**Caveats:** (1) `pickup_time` / `return_time` must concatenate to a string Postgres can cast to `timestamp` (e.g. `10:00` → may need `:00` seconds). (2) **Timeless** outbound (`pickup_time` null) is **excluded** here — those rows legitimately have `scheduled_at IS NULL` until dispatch sets time. (3) If any production row was **manually edited** after generation, it will still differ from rule — triage before bulk update.

**Practical alternative:** run the **scope query** only, export CSV, compute expected ISO in TypeScript with **`combineYmdAndHmToIsoString`** (same as app) and diff — avoids SQL string-format edge cases.

---

## Section 3 — `duplicate-trip-schedule.ts` pattern

### 3a — `combineYmdAndHmToIsoString`

**Signature** (`src/features/trips/lib/duplicate-trip-schedule.ts` lines 91–107):

```91:107:src/features/trips/lib/duplicate-trip-schedule.ts
export function combineYmdAndHmToIsoString(
  targetDateYmd: string,
  hm: string
): string {
  const trimmed = hm.trim();
  const m = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    throw new Error('Ungültige Uhrzeit.');
  }
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  const inTz = tz(getTripsBusinessTimeZone());
  const dayStart = startOfDay(inTz(targetDateYmd), { in: inTz });
  const withClock = setMinutes(setHours(dayStart, h, { in: inTz }), min, {
    in: inTz
  });
  return withClock.toISOString();
}
```

**Mechanism:** `tz(getTripsBusinessTimeZone())` gives a Berlin (or configured) zoned context; `startOfDay` of `targetDateYmd` in that zone; apply hours/minutes **in zone**; emit **UTC** ISO string. This matches Fahrten’s `getZonedDayBoundsIso` philosophy.

### 3b — Reuse matrix

| Consumer | Verdict | Why |
|----------|---------|-----|
| `combineDepartureForTripInsert` | **ADAPT** | Same YMD + `HH:mm` shape; replace local `Date` construction with `combineYmdAndHmToIsoString` **or** extract shared helper; must keep `requested_date` behavior for time-open. |
| `toScheduledIso` (cron) | **YES / ADAPT** | **Drop-in** conceptually: use same YMD + clock; **also** fix RRule `dateStr` to Berlin YMD (separate change). |
| `applyTimeToScheduledDate` | **ADAPT** | Today: “replace time on existing instant” in **local**. Options: reinterpret “time change” as Berlin wall time on the **Berlin** calendar day of `scheduledIso`, or delegate to zoned helpers. |
| `buildScheduledAtFromYmdAndHm` | **YES (as thin wrapper)** | Nearly identical to `combineYmdAndHmToIsoString`; avoid duplication by **one** exported `buildScheduledAtInBusinessTz` used by both. |
| Dashboard widgets | **YES (drop-in)** | Replace `set(new Date(ymd), …)` with Berlin zoned combine. |

### 3c — `@date-fns/tz` imports

**Already import `tz`:** `trip-business-date.ts`, `duplicate-trip-schedule.ts`.

**Would need new imports** if refactored to use the same pattern: `departure-schedule.ts`, `apply-time-to-scheduled.ts`, `build-trip-details-patch.ts` (indirect), `generate-recurring-trips/route.ts`, `timeless-rule-trips-widget.tsx`, `pending-tours-widget.tsx`, and any file that becomes the shared helper.

**`package.json`:** `"@date-fns/tz": "^1.4.1"` — **present**. **Temporal** is **not** listed as a dependency; not required if `date-fns` + `tz` remains the standard.

**`vercel.json`:** Only `installCommand`, `buildCommand`, `crons` — **no** `TZ` env in repo (lines 1–9).

---

## Section 4 — Risk assessment

### 4a — Fixing cron only: existing bad rows

Existing `ingestion_source = 'recurring_rule'` rows **keep** wrong UTC until **backfill** or manual edit. Fahrten will show **wrong clock** (and occasional wrong day near edges). **Acceptable short term** only if dispatch knows; **not** acceptable long term for billing, driver apps, and trust.

**Backfill risk:** wrong **update** without join to `recurring_rules` can corrupt rows; must be **scripted** with per-leg clock selection and a **dry-run** diff.

### 4b — Fixing write path to Berlin while users use Europe/Berlin browsers

For a dispatcher whose **browser** is **Europe/Berlin**, **local midnight** and **Berlin** midnight for a given calendar date are the **same**: `new Date(2026, 3, 27, 10, 0)` and `combineYmdAndHmToIsoString('2026-04-27','10:00')` yield the **same UTC instant** (for that date in standard local mode). **Values do not change** for typical in-region users.

They **would** change for **remote** workers (browser **not** Berlin) — which is exactly the **latent risk** the fix removes.

### 4c — Risk ranking (highest first)

| Rank | Change | Why |
|------|--------|-----|
| 1 | **Historical backfill** (data migration) | Irreversible if wrong; needs staging, diff, rollback plan. |
| 2 | **Cron fix** + **RRule `dateStr`** | Touches **all new** recurring materialization; must deploy with monitoring. |
| 3 | **Write-path unification** | Broad surface area; mitigated if Berlin users → no visible change. |
| 4 | **Driver `getDriverTrips` date filter** | Small, localized; **high user visibility** but **low** code complexity. |
| 5 | **Dashboard widgets** | Small files; fix is **surgical** once helper exists. |

**Riskiest single change:** A **one-shot SQL backfill** without leg-level validation (outbound vs return clocks) — **data integrity** risk exceeds a pure code deploy.

---

## Section 5 — Senior recommendation (mandatory)

### 5a — Order of work

Ship order should follow **blast radius** and **reversibility**. First, add **automated tests** for “Berlin YMD + HH:mm → expected ISO” (Section 5e) and land a **shared helper** used by **new** code paths — before mutating production data. Second, fix **read** bugs that **mis-route** users (**driver `getDriverTrips` date** and **dashboard widgets**): they are **localized**, **low rollback cost**, and restore trust on the Touren screen and dispatch widgets without touching historical trip rows. Third, fix the **cron** (time encoding + Berlin occurrence date + Berlin `today` window) and deploy; **monitor** generated trips against a few **golden** rules in staging. Fourth, **write-path** unification for create/edit/kanban/reschedule: for Berlin-based dispatchers this is often a **no-op** in stored values but removes **latent** cross-timezone failure. Fifth, **backfill** recurring rows: only after cron is **correct** and you can **recompute** expected instants deterministically; run **dry-run**, take a **backup**, then apply in a **maintenance window**.

This order optimizes **production pain relief** (driver + widgets + stop the bleeding on new cron rows) before the **irreversible** step.

### 5b — Cron before or after write path

**Arguments for cron first:** recurring trips are **machine-generated** at scale; wrong cron poisons **many** rows **per day**; fixing the source stops **new** bad data immediately.

**Arguments for write path first:** manual trips dominate **subjective** dispatcher experience; Berlin explicit encoding is the **pattern** you want cron to **call** (one helper).

**Recommendation:** Implement the **shared Berlin instant builder** first (one source of truth), then wire **cron** to it (stops mass bad data), then **write paths** (human entry). **Cron before** a full human write-path rollout is acceptable **if** the helper exists so cron does not fork another ad hoc fix.

### 5c — Historical data

**SQL backfill** is the **right** end state if you need **correct** `scheduled_at` for analytics, invoices, and driver trust — but only with **leg-aware** recomputation from `recurring_rules` + `trips.requested_date` + `link_type`. **Delete + re-cron** is **destructive** (loses edits, `linked_trip_id` stability, exceptions); only consider in a **greenfield** tenant or with a full export. **Leave as-is** is **lowest short-term risk** but perpetuates wrong clocks until manual edit — **honest** trade-off: acceptable only with **communicated** limitation and a **deadline** for backfill.

**Opinion:** Prefer **scripted backfill** from **recomputed** expected ISO (TypeScript using the same helper as production) with a **CSV diff** signed off by ops — not hand-written SQL for every edge case.

### 5d — Single utility?

A **single** function such as `buildScheduledAtInBusinessTz(ymd: string, hm: string): string` (plus a **`null`** / time-open path) is **worth it** for **YMD + clock** paths. It will **not** unify **everything** without satellite helpers: **edit existing instant’s time** (`applyTimeToScheduledDate`), **RRule date** extraction, and **delta** logic for duplicate return legs need **adjacent** APIs. The **diversity** is manageable if **all** paths **compose** the same zoned primitives (`getTripsBusinessTimeZone`, `tz`, `startOfDay` in zone) — **do not** copy-paste three variants of Berlin math.

### 5e — Regression test (concrete)

**Where:** `src/features/trips/lib/__tests__/trip-business-date.test.ts` (new) or next to `duplicate-trip-schedule` tests if you colocate (`src/features/trips/lib/__tests__/duplicate-trip-schedule.test.ts`).

**Input:** `getTripsBusinessTimeZone()` pinned in test via `process.env.NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE = 'Europe/Berlin'` (or mock), then call the shared builder with:

- `ymd = '2026-06-15'`, `hm = '10:00'` (CEST scenario)

**Assertion:** result string === `'2026-06-15T08:00:00.000Z'` (or the exact ISO your helper produces for that Berlin local time).

**Second case (CET):** `ymd = '2026-01-15'`, `hm = '10:00'` → expect `'2026-01-15T09:00:00.000Z'`.

**Negative control:** document that the **old** `new Date(\`${ymd}T10:00:00\`)` on **UTC** would yield `10:00Z` — optional separate test in a **cron-specific** module mock.

This locks the **contract** between **business YMD + HH:mm** and **stored UTC**, which is exactly what Fahrten assumes when it bucket-tests `scheduled_at`.

---

## Appendix — Files read for this document

- `src/features/trips/lib/trip-business-date.ts` (full)
- `src/features/driver-portal/api/driver-trips.service.ts` (full)
- `src/features/trips/lib/departure-schedule.ts` (full)
- `src/features/trips/trip-detail-sheet/lib/apply-time-to-scheduled.ts` (full)
- `src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts` (full)
- `src/features/trips/lib/duplicate-trip-schedule.ts` (full)
- `src/features/trips/lib/build-return-trip-insert.ts` (full)
- `src/app/api/cron/generate-recurring-trips/route.ts` (substantive first 480 lines + known tail)
- `src/features/dashboard/components/timeless-rule-trips-widget.tsx` (substantive)
- `src/features/dashboard/components/pending-tours-widget.tsx` (substantive)
- `package.json` (dependencies header)
- `vercel.json` (full)
- `src/types/database.types.ts` (`recurring_rules` row)

Reschedule parsing: `src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx` (referenced; no separate `parse-local-ymd-hm.ts`).
