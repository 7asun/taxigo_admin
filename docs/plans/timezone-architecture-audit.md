# Timezone architecture audit — manual vs Regelfahrten cron

**Date:** 2026-06-01  
**Scope:** Read-only. No code changes.  
**Goal:** Compare Berlin timezone handling on **manual trip creation** vs **Regelfahrten cron**, answer Q1–Q6, and recommend a fix strategy before implementing the DTSTART patch.

---

## Part A — Documentation reviewed

### Required reads (full)

| File | Timezone relevance |
| --- | --- |
| [`docs/trips-date-filter.md`](../trips-date-filter.md) | **Authoritative shipped inventory.** Read vs write split: `trip-business-date.ts` (reads), `trip-time.ts` (writes). Phases 2–5 migration table. |
| [`docs/plans/cron-trip-generation-audit.md`](./cron-trip-generation-audit.md) | **Partially stale.** Written 2026-04-29 pre–Phase 2. Still valid on Vercel UTC runtime; **incorrect** on current cron (`toScheduledIso`, UTC `startOfDay`, UTC `dateStr` were fixed). **Does not mention DTSTART bug.** |

### Filename keyword matches in `docs/` (18 files — all read)

| File | Summary |
| --- | --- |
| [`docs/date-picker.md`](../date-picker.md) | `DatePicker` emits local-calendar `yyyy-MM-dd`; pairs with `<input type="time">` for create/reschedule. |
| [`docs/trips-date-filter.md`](../trips-date-filter.md) | *(see above)* |
| [`docs/plans/timezone-master-audit.md`](./timezone-master-audit.md) | Consolidated findings; **partially stale** (cron + driver Touren sections pre-fix). |
| [`docs/plans/cron-trip-generation-audit.md`](./cron-trip-generation-audit.md) | *(see above)* |
| [`docs/plans/pickup-time-mode-feasibility-audit.md`](./pickup-time-mode-feasibility-audit.md) | Timeless rules + cron null `pickup_time`; no Berlin write-path architecture. |
| [`docs/plans/timezone-bug-audit-v2.md`](./timezone-bug-audit-v2.md) | v2 addendum to master audit; tracks Phase 2–5 fixes; still lists cron as fixed for `buildScheduledAt` but not DTSTART. |
| [`docs/plans/regelfahrten-cron-day-offset-audit.md`](./regelfahrten-cron-day-offset-audit.md) | **Current.** DTSTART + RRule UTC → +1 Berlin day on `requested_date`. |
| [`docs/plans/recurring-rules-audit.md`](./recurring-rules-audit.md) | Schema + `rrule_string`; no write-path TZ detail. |
| [`docs/plans/timeless-rule-trips-audit.md`](./timeless-rule-trips-audit.md) | Dashboard widget query uses Berlin today/tomorrow. |
| [`docs/features/recurring-rules-overview.md`](../features/recurring-rules-overview.md) | Product doc; timeless outbound = `scheduled_at null` + `requested_date`. |
| [`docs/plans/timeless-rules-cron-widget-audit.md`](./timeless-rules-cron-widget-audit.md) | Cron + widget interaction; pre–Phase 3B widget bugs. |
| [`docs/plans/recurring-rules-create-from-overview-audit.md`](./recurring-rules-create-from-overview-audit.md) | Create flow UX; shares `RecurringRuleFormBody`. |
| [`docs/plans/update-driver-rpc-audit.md`](./update-driver-rpc-audit.md) | Driver RPC; tangential to trip write TZ. |
| [`docs/plans/write-path-timezone-audit.md`](./write-path-timezone-audit.md) | **Stale (pre–Phase 3A).** Documents browser-local writes; most listed paths now use `buildScheduledAt`. |
| [`docs/plans/timeless-recurring-rules-audit.md`](./timeless-recurring-rules-audit.md) | Timeless outbound/return modes + cron behaviour. |
| [`docs/plans/trip-time-utility-audit.md`](./trip-time-utility-audit.md) | Migration plan; marks Phases 1–5 complete; cron line refs still say `toScheduledIso` at 51–53 (now `buildScheduledAt`). |
| [`docs/plans/recurring-rules-overview-audit.md`](./recurring-rules-overview-audit.md) | Table columns; no TZ write path. |
| [`docs/plans/phase_2_berlin_tz_01e0cd43.plan.md`](./phase_2_berlin_tz_01e0cd43.plan.md) | Phase 2 plan: cron `buildScheduledAt`, Berlin window, `instantToYmdInBusinessTz`; **did not specify DTSTART TZID fix.** |

**Note:** There is **no** `POST /api/trips` route. Manual creation uses the browser Supabase client (`tripsService.createTrip`). There are **no** Supabase Edge Functions for trip generation.

---

## Part B — Manual trip creation path (findings)

### Entry points

| File | Role |
| --- | --- |
| [`src/features/trips/components/create-trip/create-trip-form.tsx`](../src/features/trips/components/create-trip/create-trip-form.tsx) | Main “Neue Fahrt” submit handler |
| [`src/features/trips/components/create-trip/sections/schedule-section.tsx`](../src/features/trips/components/create-trip/sections/schedule-section.tsx) | `DatePicker` + `<input type="time">` |
| [`src/features/trips/lib/departure-schedule.ts`](../src/features/trips/lib/departure-schedule.ts) | **`combineDepartureForTripInsert`** — outbound date/time → DB fields |
| [`src/features/trips/lib/trip-time.ts`](../src/features/trips/lib/trip-time.ts) | **`buildScheduledAt`** — Berlin wall clock → UTC ISO |
| [`src/features/trips/api/trips.service.ts`](../src/features/trips/api/trips.service.ts) | **`createTrip`** — pass-through insert, no TZ transform |

No `src/lib/utils/date.ts`. Shared YMD parsing lives in [`src/lib/date-ymd.ts`](../src/lib/date-ymd.ts) (local calendar `Date`, used by `DatePicker` display only).

---

## Manual trip creation — data flow (text diagram)

```
User (Neue Fahrt)
  │
  ├─ Abfahrtsdatum: DatePicker
  │     onChange → form.departure_date : string  ("yyyy-MM-dd", browser local calendar day)
  │
  ├─ Uhrzeit: <input type="time">
  │     → form.departure_time : string  ("HH:mm" or "")
  │
  ▼
create-trip-form.tsx onSubmit
  │
  ├─ combineDepartureForTripInsert(departure_date, departure_time)
  │     ├─ requested_date := departure_date trimmed (verbatim YMD string)
  │     ├─ if no time → scheduled_at := null
  │     └─ if time     → scheduled_at := buildScheduledAt(ymd, timePart)
  │                         └─ @date-fns/tz + getTripsBusinessTimeZone() (default Europe/Berlin)
  │
  ├─ Return leg (return_mode === 'exact'):
  │     requested_date := formatLocalYmd(return_date)  [Date → YMD via browser local fields]
  │     scheduled_at   := buildScheduledAt(formatLocalYmd(return_date), return_time)
  │
  ▼
tripsService.createTrip({ ... requested_date, scheduled_at, ... })
  │
  ▼
Supabase INSERT public.trips
  columns: requested_date (date), scheduled_at (timestamptz UTC ISO)
```

**Return / linked flows** (same TZ stack): `build-return-trip-insert.ts` accepts pre-built ISO from `buildScheduledAt`; `create-return-trip-dialog.tsx` derives `ymd`/`hm` from `DateTimePicker` then calls `buildScheduledAt`.

---

## Part C — Regelfahrten cron path (summary + reference)

Full weekday-offset analysis: [`regelfahrten-cron-day-offset-audit.md`](./regelfahrten-cron-day-offset-audit.md).

```
recurring_rules.rrule_string  (e.g. FREQ=WEEKLY;BYDAY=MO)
recurring_rules.start_date    (YYYY-MM-DD)
  │
  ▼
generate-recurring-trips/route.ts
  │
  ├─ today + 14d window     → startOfDay/endOfDay in getTripsBusinessTimeZone()  ✅
  ├─ DTSTART construction     → getZonedDayBoundsIso(start_date).startISO
  │                             formatted as UTC "…Z" (e.g. 20260531T220000Z)  ❌
  ├─ rrulestr(DTSTART + rrule_string).between(range)  → UTC Date[] occurrences
  │
  for each occurrence:
  ├─ dateStr := instantToYmdInBusinessTz(dateUTC.getTime())   ← Berlin YMD  ❌ +1 day vs BYDAY
  ├─ scheduled_at := buildScheduledAt(dateStr, pickup_time)   OR null (timeless)
  ├─ requested_date := dateStr
  │
  ▼
supabase.from('trips').insert(...)
```

**Cron uses the same `buildScheduledAt` as manual creation** for `scheduled_at`, but feeds it a **`dateStr` that is wrong** because RRule occurrence selection runs in UTC while `instantToYmdInBusinessTz` maps those instants to Berlin civil dates.

---

## Part D — Helper inventory

### Core modules (timezone-related exports)

| Function | File | Signature (summary) | One-line purpose | Used by |
| --- | --- | --- | --- | --- |
| `getTripsBusinessTimeZone` | `trip-business-date.ts` | `(): string` | IANA zone for ops calendar (default `Europe/Berlin`) | Reads, writes, duplicate, cron window |
| `isYmdString` | `trip-business-date.ts` | `(value: string): boolean` | Validates `YYYY-MM-DD` | `buildScheduledAt` |
| `instantToYmdInBusinessTz` | `trip-business-date.ts` | `(ms: number): string` | UTC instant → Berlin calendar YMD | Cron occurrences, widgets, duplicate return |
| `todayYmdInBusinessTz` | `trip-business-date.ts` | `(): string` | Berlin “today” YMD | Filters, recurring delete cutoff, kanban fallback |
| `getZonedDayBoundsIso` | `trip-business-date.ts` | `(ymd: string) → { startISO, endExclusiveISO }` | Half-open UTC bounds for one Berlin day | Fahrten list, driver Touren, cron search window, upcoming trips |
| `ymdToPickerDate` | `trip-business-date.ts` | `(ymd: string): Date` | Berlin-interpreted picker anchor | Timeless widget tomorrow calc |
| `buildScheduledAt` | `trip-time.ts` | `(ymd, hm, timeZone?): string` | Berlin YMD + wall clock → UTC ISO | **Manual create**, cron, kanban, bulk CSV, detail sheet, reschedule, widgets |
| `buildScheduledAtOrNull` | `trip-time.ts` | `(ymd?, hm?, timeZone?): string \| null` | Nullable wrapper | Widgets, timeless flows |
| `parseScheduledAt` | `trip-time.ts` | `(iso, timeZone?) → { ymd, hm }` | UTC ISO → Berlin YMD + HH:mm | Detail sheet, kanban, reschedule init |
| `parseScheduledAtOrFallback` | `trip-time.ts` | `(iso?) → { ymd, hm } \| null` | Safe parse for display | Pending assignments, pending tours widget |
| `TripTimeError` | `trip-time.ts` | `class` | Invalid date/time input | All `buildScheduledAt` callers |
| `combineDepartureForTripInsert` | `departure-schedule.ts` | `(ymd, hhmm) → { scheduled_at, requested_date }` | **Create-trip outbound** pair builder | `create-trip-form.tsx` |
| `parseYmdToLocalDate` | `departure-schedule.ts` | `(ymd) → Date \| undefined` | Local calendar parse (validation only in combine) | departure-schedule, duplicate-schedule |
| `formatLocalYmd` | `departure-schedule.ts` | `(d: Date) → string` | Browser-local YMD from `Date` | create-trip return leg |
| `combineYmdAndHmToIsoString` | `duplicate-trip-schedule.ts` | `(targetDateYmd, hm) → string` | Berlin YMD + time → ISO (duplicate-specific) | Duplicate dialog; **parallel impl** to `buildScheduledAt` |
| `computePreserveScheduleForLeg` | `duplicate-trip-schedule.ts` | `(sourceLeg, targetDateYmd) → { scheduled_at, requested_date }` | Copy wall clock to new Berlin day | Duplicate preserve mode |
| `applyTimeToScheduledDate` | `apply-time-to-scheduled.ts` | `(iso, hhmm) → Date` | Change clock on existing Berlin day | Detail sheet dirty state |
| `buildScheduledAtFromYmdAndHm` | `apply-time-to-scheduled.ts` | `(ymd, hhmm) → Date` | Wrapper returning `Date` | Detail sheet patch builder |
| `parseYmdToLocalDate` | `src/lib/date-ymd.ts` | `(ymd) → Date \| undefined` | Local calendar for pickers | `DatePicker`, date-time-picker |
| `formatLocalDateToYmd` | `src/lib/date-ymd.ts` | `(d: Date) → string` | Local calendar YMD | Invoice periods, pickers |

### Callsite coverage (grep snapshot)

**Uses `buildScheduledAt`:** create-trip-form, departure-schedule, cron, bulk-upload, kanban-trip-card, use-pending-assignments, trip-reschedule-dialog, create-return-trip-dialog, apply-time-to-scheduled, build-trip-details-patch, dashboard widgets (timeless, pending-tours).

**Uses `getZonedDayBoundsIso` / `instantToYmdInBusinessTz`:** trips-listing, driver-trips (date filter — **fixed**), cron search window, use-upcoming-trips, duplicate-trip-schedule.

---

## Q1 — How does manual trip creation handle Berlin timezone?

| Question | Answer |
| --- | --- |
| What ends up in `requested_date`? | The **`yyyy-MM-dd` string from the form** (`departure_date`), stored verbatim. It is treated as the **dispatcher’s intended calendar day**, not derived from `scheduled_at`. |
| What ends up in `scheduled_at`? | When time is set: **`buildScheduledAt(ymd, hm)`** → UTC ISO representing **Berlin wall-clock** on that YMD. When time empty: **`null`** (Zeitabsprache); day still on `requested_date`. |
| Always Berlin calendar date? | **`requested_date`** is whatever YMD the UI captured. **`buildScheduledAt`** always interprets that YMD in **`getTripsBusinessTimeZone()`** (Berlin by default). |
| Correct UTC instant for entered time? | **Yes**, for the outbound leg and return leg when `buildScheduledAt` is used (Phase 3A shipped). Unit tests in `trip-time.test.ts` lock CEST/CET/DST edges. |
| Same helpers as cron? | **Partially.** Cron uses **`buildScheduledAt`** for `scheduled_at` (same as manual) but derives **`requested_date`** via **RRule + `instantToYmdInBusinessTz`** (manual uses form YMD directly). |

**Residual manual-path nuance (not the cron bug class):**

- `DatePicker` emits YMD using **browser local calendar** (`date-time-picker.tsx` lines 342–348). Product assumes dispatchers work in Germany / Berlin-aligned browsers.
- Default `departure_date: format(new Date(), 'yyyy-MM-dd')` uses **browser “today”**, not `todayYmdInBusinessTz()` — edge case only near midnight for non-Berlin browsers.
- Return leg uses `formatLocalYmd(return_date)` (browser local) before `buildScheduledAt` — same assumption.

**Manual path does not use** `new Date(\`${dateStr}T${time}\`).toISOString()` for persistence (removed in Phase 3A).

---

## Q2 — Is there a single canonical “Berlin date → DB value” helper?

**No single function returns `{ requested_date, scheduled_at }` for all paths**, but the architecture is intentionally split:

| Layer | Canonical helper | Contract |
| --- | --- | --- |
| **Calendar day (read + label)** | `instantToYmdInBusinessTz`, `todayYmdInBusinessTz`, `getZonedDayBoundsIso` | Berlin civil date and day windows |
| **Wall clock → UTC instant** | **`buildScheduledAt(ymd, hm)`** | One YMD string + HH:mm → `scheduled_at` ISO |
| **Create outbound pair** | **`combineDepartureForTripInsert(ymd, hm)`** | Returns `{ requested_date: ymd, scheduled_at: buildScheduledAt(...) \| null }` |

**Cron and DTSTART:** Cron **uses `buildScheduledAt` correctly** for time encoding but **does not use any canonical helper for occurrence calendar days**. It relies on **RRule UTC semantics + `instantToYmdInBusinessTz`**, which is where the weekday +1 bug lives. DTSTART is built ad hoc at lines 495–504, **not** via `buildScheduledAt` or `getZonedDayBoundsIso`’s YMD string in TZID form.

**Duplicate path duplication:** `combineYmdAndHmToIsoString` in `duplicate-trip-schedule.ts` reimplements Berlin setHours/setMinutes instead of calling `buildScheduledAt` — same intent, two implementations.

---

## Q3 — Is manual creation correct? Same bug class as cron?

| Path | Bug class (naïve UTC / wrong day) | Verdict |
| --- | --- | --- |
| **Manual create (outbound)** | Uses `buildScheduledAt` | **Correct** for Berlin intent |
| **Manual create (return exact)** | Uses `buildScheduledAt` | **Correct** |
| **Detail sheet / kanban / bulk / reschedule / widgets** | Migrated to `buildScheduledAt` (Phases 3B–4) | **Correct** (per shipped inventory) |
| **Regelfahrten cron** | Wrong **`requested_date`** from RRule UTC; **`scheduled_at`** consistent with wrong date | **Wrong weekday (+1 day)** — **cron-only** for recurrence selection |
| **Duplicate `combineYmdAndHmToIsoString`** | Berlin zoned | **Correct** (duplicate of `buildScheduledAt` logic) |

**Explicit checks:**

- Manual create **does not** persist via `new Date(dateString + 'Z')`.
- Manual create **does not** call `toISOString()` on a naïve local string for `scheduled_at`; it uses **`buildScheduledAt`** which internally produces UTC ISO from Berlin components.
- Cron **no longer** uses `toScheduledIso` / `new Date(\`${dateStr}T${t}\`)` — replaced by **`scheduledIsoFromBerlinCalendarAndClock` → `buildScheduledAt`**. The **remaining** cron bug is **occurrence date selection (DTSTART)**, not time encoding.

**Conclusion:** Only the **cron RRule path** has the +1 Berlin day bug class today. Manual creation is **aligned with documented architecture**.

---

## Q4 — Audit questions (data flows & helpers)

### 1. Manual trip data flow

See **Manual trip creation — data flow** above. Key field names:

- Form: `departure_date`, `departure_time`, `return_date`, `return_time`, `return_mode`
- DB: `trips.requested_date`, `trips.scheduled_at`
- Transport: `tripsService.createTrip` (no server API)

### 2. Cron data flow

See **Regelfahrten cron path** above; detail in [`regelfahrten-cron-day-offset-audit.md`](./regelfahrten-cron-day-offset-audit.md).

### 3. Timezone helper list

See **Part D — Helper inventory** table.

### 4. Do both paths use the same helpers for Berlin → DB?

| Step | Manual | Cron | Match? |
| --- | --- | --- | --- |
| Pick calendar day | Form YMD string | `instantToYmdInBusinessTz(rrule occurrence)` | **No** — cron path broken |
| Encode wall time | `buildScheduledAt` | `buildScheduledAt` | **Yes** |
| Day filter bounds | N/A at insert | `getZonedDayBoundsIso` + Berlin `startOfDay` | N/A |

**Correct path for calendar day:** Manual (trust dispatcher YMD). Cron should produce the **same YMD** the dispatcher would have picked for that weekday.

### 5. Missing canonical `{ requested_date, scheduled_at }` helper?

**Does not exist as one export.** Closest:

```typescript
// de facto contract today (departure-schedule.ts)
combineDepartureForTripInsert(ymd: string, hhmm: string): {
  scheduled_at: string | null;
  requested_date: string | null;
}
```

**Cron does not call this.** It sets `requested_date` and `scheduled_at` separately in `buildTripPayload` after computing `dateStr` from RRule.

**Proposed unified contract (for future, not implemented):**

```typescript
// Option A — extend existing
combineDepartureForTripInsert(ymd, hm)  // already sufficient when ymd is known

// Option B — cron-specific occurrence expansion (replace RRule dateStr)
expandRecurringOccurrenceYmds(params: {
  rruleString: string;
  startDateYmd: string;
  searchStartYmd: string;
  searchEndYmd: string;
}): string[]  // Berlin calendar days matching BYDAY
```

### 6. Docs vs code consistency

| Doc | Status |
| --- | --- |
| [`trips-date-filter.md`](../trips-date-filter.md) | **Accurate** for shipped Phases 2–5 |
| [`AGENTS.md`](../../AGENTS.md) Trips time invariant | **Accurate** (`buildScheduledAt`, `getZonedDayBoundsIso`) |
| [`cron-trip-generation-audit.md`](./cron-trip-generation-audit.md) | **Stale** — references removed `toScheduledIso`, UTC `dateStr`, UTC `todayLocal` |
| [`write-path-timezone-audit.md`](./write-path-timezone-audit.md) | **Stale** — pre–Phase 3A browser-local writes |
| [`timezone-master-audit.md`](./timezone-master-audit.md) | **Partially stale** — driver `getDriverTrips` UTC window **fixed** in code; cron Finding 2 half-fixed |
| [`trip-time-utility-audit.md`](./trip-time-utility-audit.md) | **Mostly accurate** status; line refs to old cron code |
| [`regelfahrten-cron-day-offset-audit.md`](./regelfahrten-cron-day-offset-audit.md) | **Current** for DTSTART bug |

**Contradiction:** Phase 2 docs claim cron is “fixed” for Berlin semantics because `buildScheduledAt` + `instantToYmdInBusinessTz` shipped, but **`instantToYmdInBusinessTz` applied to UTC RRule occurrences** is exactly what **causes** the weekday offset. The fix was necessary but **insufficient** without DTSTART/TZID or Berlin day iteration.

---

## Gap analysis

| Gap | Severity | Notes |
| --- | --- | --- |
| Cron DTSTART as UTC `Z` | **High** | +1 Berlin day on `requested_date` for weekly rules |
| No shared “expand BYDAY in Berlin” helper | **Medium** | Cron ad hoc RRule; manual doesn’t need it |
| `combineYmdAndHmToIsoString` duplicates `buildScheduledAt` | **Low** | Tech debt; behaviour aligned |
| `formatLocalYmd` / `DatePicker` use browser local YMD | **Low** | Acceptable if ops = Berlin browsers |
| Stale audit docs | **Low** | Mislead future agents; update after cron fix |
| `getTodaysTrips` device-local window | **Low** | Documented out-of-scope in trips-date-filter |

---

## Senior recommendation

### (a) Regelfahrten DTSTART fix — still Option 1, validated by manual path

Manual creation proves the stack **`YMD string (intent) + buildScheduledAt (time)`** works. The cron should **not** invent calendar days from UTC RRule instants.

**Recommended fix (unchanged from regelfahrten audit):** Replace UTC `Z` DTSTART with:

```text
DTSTART;TZID=Europe/Berlin:{start_date}T000000
```

using `getTripsBusinessTimeZone()` for the TZID. Local simulation shows `instantToYmdInBusinessTz` then yields the correct weekday.

**Alternative (better long-term, more code):** Replace `rrule.between()` date discovery with **Berlin calendar iteration** + parse `BYDAY` from `rrule_string` — mirrors how manual create trusts explicit YMD. Manual path does **not** reveal a better approach than TZID DTSTART for minimal diff.

### (b) Should a canonical Berlin-date helper be introduced?

**For the cron fix alone: no new public API required** — DTSTART one-liner is sufficient.

**Optional follow-up (separate PR):**

1. **`buildTripScheduleFields(ymd, hm?)`** — alias or thin rename of `combineDepartureForTripInsert` exported from `trip-time.ts` or `departure-schedule.ts` for discoverability.
2. **`expandBerlinWeeklyOccurrences(...)`** — cron-only; encapsulates RRule/TZID or day-walk logic so DTSTART math isn’t inline in the route handler.
3. **Consolidate** `combineYmdAndHmToIsoString` → delegate to `buildScheduledAt`.

### (c) Other inconsistencies to fix in the same PR

| Item | Include in DTSTART PR? |
| --- | --- |
| DTSTART TZID fix | **Yes — primary** |
| Update [`cron-trip-generation-audit.md`](./cron-trip-generation-audit.md) + [`trips-date-filter.md`](../trips-date-filter.md) cron row | **Yes — doc only** |
| Refactor `combineYmdAndHmToIsoString` → `buildScheduledAt` | Optional / separate |
| Berlin day iteration instead of RRule | Optional if TZID proves insufficient in staging |
| Backfill wrong `requested_date` on existing cron trips | **Product decision** — out of scope for code-only fix |

---

## Files read (code)

| File | Extent |
| --- | --- |
| `docs/trips-date-filter.md` | Full |
| `docs/plans/cron-trip-generation-audit.md` | Full |
| 18 filename-matched `docs/` files | Full (see Part A table) |
| `src/features/trips/components/create-trip/create-trip-form.tsx` | Submit + schedule integration |
| `src/features/trips/lib/departure-schedule.ts` | Full |
| `src/features/trips/lib/trip-time.ts` | Full |
| `src/features/trips/lib/trip-business-date.ts` | Full |
| `src/features/trips/api/trips.service.ts` | createTrip path |
| `src/components/ui/date-time-picker.tsx` | DatePicker emit logic |
| `src/features/trips/trip-detail-sheet/lib/apply-time-to-scheduled.ts` | Full |
| `src/features/trips/lib/duplicate-trip-schedule.ts` | Schedule helpers |
| `src/app/api/cron/generate-recurring-trips/route.ts` | Full (re-read for comparison) |
| `src/lib/date-ymd.ts` | Full |

**Not found (as expected):** `src/app/api/trips/route.ts`, `lib/cron.ts`, `lib/regelfahrten.ts`, Supabase Edge Functions for trips.
