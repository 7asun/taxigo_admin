# Regelfahrten cron — weekday one-day-forward offset audit

**Date:** 2026-06-01  
**Scope:** Read-only. No code or schema changes.  
**Symptom:** User selects **Montag (Monday)** in the Regelfahrten UI; cron materializes trips on **Dienstag (Tuesday)** — a consistent +1 calendar-day shift in `Europe/Berlin`.

**Files reviewed (complete read where noted):**

| Area | Path | Notes |
| --- | --- | --- |
| Client detail + rules list | `src/features/clients/components/client-detail-panel.tsx` | Delegates rules to `RecurringRulesList`; no weekday logic |
| Rule form (weekday UI) | `src/features/clients/components/recurring-rule-form-body.tsx` | **Full read** — `DAYS_OF_WEEK`, checkboxes, `buildRecurringRulePayload` input |
| Rule panel (save path) | `src/features/clients/components/recurring-rule-panel.tsx` | **Full read** |
| Payload builder | `src/features/clients/lib/build-recurring-rule-payload.ts` | **Full read** — builds `rrule_string` |
| Trip generator (cron) | `src/app/api/cron/generate-recurring-trips/route.ts` | **Full read** — RRule + `requested_date` |
| Business TZ helpers | `src/features/trips/lib/trip-business-date.ts` | **Full read** |
| Scheduled-at helper | `src/features/trips/lib/trip-time.ts` | **Full read** — used after `dateStr` is chosen |
| DB types | `src/types/database.types.ts` (`recurring_rules`, `trips`) | Column shapes |
| Migrations | `supabase/migrations/20260327120000_recurring_rules_billing.sql` (+ related ALTERs) | No `weekday` integer column |
| Edge Functions | *(none)* | **No Supabase Edge Function** generates trips; scheduling is Vercel Cron → Next.js API route |
| `lib/cron.ts` / `lib/regelfahrten.ts` | *(not present)* | Cron logic lives only in the API route above |

---

## Root cause hypothesis

**Primary: B — UTC / timezone boundary shift (via RRule), not A or C.**

- **Not A (day-of-week indexing mismatch):** The UI never sends numeric weekday integers (`0`–`6` or ISO `1`–`7`). It stores **iCalendar `BYDAY` tokens** (`MO`, `TU`, …). No translation layer maps Monday → wrong index.
- **Not C (simple off-by-one arithmetic):** There is no `addDays(date, weekday)` or `setDay(date, weekday)` bug. The +1 day comes from **RRule occurrence instants** that satisfy `BYDAY=MO` in **UTC** but fall on **the next Berlin calendar date** when converted with `instantToYmdInBusinessTz`.
- **B (confirmed in local simulation):** DTSTART is built as Berlin local midnight, serialized as a **UTC `…Z` timestamp**. The `rrule` library evaluates weekly `BYDAY` in UTC. Occurrences land at **Monday 22:00 UTC (CEST)** or **Monday 23:00 UTC (CET)**, which is **Tuesday 00:00 in Berlin**. The cron then correctly (but harmfully) writes that Berlin date into `trips.requested_date`.

**Exact origin:** `src/app/api/cron/generate-recurring-trips/route.ts` **lines 495–505** (DTSTART construction) and **lines 533–543** (occurrence → `dateStr` via `instantToYmdInBusinessTz`).

---

## Audit question 1 — Where does the weekday value originate?

**Component:** `RecurringRuleFormBody` in `recurring-rule-form-body.tsx` (used from `client-detail-panel.tsx` → `RecurringRulesList` → `RecurringRulePanel` / `RecurringRuleSheet`).

**Control:** Checkbox grid “Wochentage” bound to form field `days: string[]`.

**Constants (lines 108–116):**

```108:116:src/features/clients/components/recurring-rule-form-body.tsx
export const DAYS_OF_WEEK = [
  { id: 'MO', label: 'Montag' },
  { id: 'TU', label: 'Dienstag' },
  { id: 'WE', label: 'Mittwoch' },
  { id: 'TH', label: 'Donnerstag' },
  { id: 'FR', label: 'Freitag' },
  { id: 'SA', label: 'Samstag' },
  { id: 'SU', label: 'Sonntag' }
] as const;
```

**When user selects Monday:**

| Property | Value |
| --- | --- |
| Form value | `'MO'` (string token in `days[]`) |
| Indexing | **None** — not 0-based JS `getDay()`, not ISO numeric weekday |
| Standard | **RFC 5545 / iCalendar `BYDAY`** abbreviations |

**Default for new rules:** `['MO','TU','WE','TH','FR']` (lines 220–221).  
**Edit mode:** Parsed back from stored `rrule_string` via `BYDAY=([^;]+)` (lines 243–244).

---

## Audit question 2 — How is the weekday value stored?

**Table:** `public.recurring_rules` (no separate `regelfahrten` table, no `weekday` integer column).

**Relevant columns:**

| Column | Type | Role |
| --- | --- | --- |
| `rrule_string` | `text` | Recurrence pattern, e.g. `FREQ=WEEKLY;BYDAY=MO` |
| `start_date` | `date` / `string` (`YYYY-MM-DD`) | Rule validity start (calendar day) |
| `end_date` | nullable date | Optional end |

**Write path:** `buildRecurringRulePayload()` (`build-recurring-rule-payload.ts` line 31):

```31:31:src/features/clients/lib/build-recurring-rule-payload.ts
  const rruleString = `FREQ=WEEKLY;BYDAY=${values.days.join(',')}`;
```

**Example — user selects only Monday, saves on 2026-06-01:**

| Field | Stored value |
| --- | --- |
| `rrule_string` | `FREQ=WEEKLY;BYDAY=MO` |
| `start_date` | `2026-06-01` (from form “Gültig ab”) |

**Transformation:** UI tokens are joined with commas; **no numeric conversion**. Order in DB follows checkbox selection order, not weekday sort.

---

## Audit question 3 — How does the cron convert weekday → trip date?

**Scheduler:** Vercel Cron `GET /api/cron/generate-recurring-trips` (`vercel.json`: `0 3 * * *` = **03:00 UTC** daily). **Not** Supabase `pg_cron`, **not** an Edge Function.

**Code path (per active rule):**

1. **Berlin “today” + 14-day window** (lines 104–108) — uses `@date-fns/tz` + `getTripsBusinessTimeZone()` (`Europe/Berlin` by default). ✅ Fixed relative to older UTC-`startOfDay` audits.

2. **DTSTART for RRule** (lines 495–505):

```495:505:src/app/api/cron/generate-recurring-trips/route.ts
      const ruleDayStartUtc = getZonedDayBoundsIso(rule.start_date).startISO;
      const dtStartAnchor = new Date(ruleDayStartUtc);
      const utcTz = tz('UTC');
      const dtStartStr = format(dtStartAnchor, "yyyyMMdd'T'HHmmss'Z'", {
        in: utcTz
      });

      let rruleObj: RRule;
      try {
        const rruleStr = `DTSTART:${dtStartStr}\n${rule.rrule_string}`;
        rruleObj = rrulestr(rruleStr) as RRule;
```

   - `getZonedDayBoundsIso(start_date)` → Berlin local **00:00** as a real instant (e.g. `2026-06-01T00:00:00+02:00` → `2026-05-31T22:00:00.000Z` in CEST).
   - Formatted with **UTC** as `20260531T220000Z` — calendar **date part is previous UTC day**.

3. **Search window for `between()`** (lines 522–531) — Berlin YMD bounds converted to UTC via `getZonedDayBoundsIso`. ✅ Intentionally Berlin-aware.

4. **Occurrences** (lines 533–537):

```533:543:src/app/api/cron/generate-recurring-trips/route.ts
      const occurrencesUTC = rruleObj.between(
        new Date(rangeStartUtc),
        rangeEndInclusive,
        true
      );
      // ...
      for (const dateUTC of occurrencesUTC) {
        const dateStr = instantToYmdInBusinessTz(dateUTC.getTime());
```

5. **`dateStr` → trip row** (line 346 in `buildTripPayload`):

   - `requested_date: dateStr`
   - `scheduled_at` built separately via `buildScheduledAt(dateStr, pickup_time)` when time is set (lines 553–563).

**Libraries:** `rrule` (`rrulestr`, `RRule.between`), `date-fns` + `@date-fns/tz`, project helpers `getZonedDayBoundsIso`, `instantToYmdInBusinessTz`, `buildScheduledAt`.

**There is no function that maps “Monday integer → date”.** Weekday filtering is entirely inside **`rrule`** interpreting `BYDAY=MO` against **UTC-based** occurrence instants.

---

## Audit question 4 — Cron execution timezone

| Layer | Timezone |
| --- | --- |
| Vercel Node runtime | **UTC** (default; no `TZ=Europe/Berlin` in `vercel.json` or `env.example.txt`) |
| Cron schedule | **03:00 UTC** (`vercel.json`) — not midnight UTC |
| “Today” / 14-day window in handler | **`Europe/Berlin`** via `getTripsBusinessTimeZone()` |
| RRule `DTSTART` / `between()` | **UTC `Z` suffix** on DTSTART; occurrences are UTC `Date` objects |
| Supabase Edge Functions | **N/A** — not used for this flow |

The bug does **not** require the cron to fire at UTC midnight. It reproduces whenever the handler runs, because the **RRule occurrence instant → Berlin YMD** step is wrong for weekly rules.

---

## Audit question 5 — Explicit timezone offsets in the chain

| Step | Offset applied? |
| --- | --- |
| UI → DB `rrule_string` | None |
| `getZonedDayBoundsIso` for DTSTART | Berlin → correct instant, then **re-labeled as UTC Z** for RRule |
| `rrule.between()` | UTC semantics |
| `instantToYmdInBusinessTz` | Berlin (single conversion, not double) |
| `buildScheduledAt(dateStr, time)` | Berlin wall clock for the **already-wrong** `dateStr` |

**Double-offset?** No duplicated `+2h`/`+1h` on the same field. The failure mode is **one semantic mismatch**: RRule thinks in UTC weekdays/times; product thinks in **Berlin calendar days**.

---

## Audit question 6 — What appears in the database after a cron run?

*No production query was run in this audit.* Values below are from **reproducing the exact DTSTART + RRule + `instantToYmdInBusinessTz` logic locally** (Node, same dependencies as the app).

### Scenario

- Rule: `rrule_string = FREQ=WEEKLY;BYDAY=MO`, `start_date = 2026-06-01` (Monday), `pickup_time = 10:00:00`
- Cron window includes that week

### RRule output (broken DTSTART path)

| Occurrence UTC (`rrule`) | Berlin `requested_date` (`instantToYmdInBusinessTz`) | Expected if user chose Monday |
| --- | --- | --- |
| `2026-06-01T22:00:00.000Z` | **`2026-06-02`** (Tuesday) | `2026-06-01` (Monday) |
| `2026-06-08T22:00:00.000Z` | **`2026-06-09`** (Tuesday) | `2026-06-08` (Monday) |

**DTSTART produced by current code:** `20260531T220000Z` (Sunday UTC calendar date, Monday 00:00 Berlin).

### Example trip row (conceptual)

| Column | Value | Notes |
| --- | --- | --- |
| `requested_date` | `2026-06-02` | **Wrong** — one day ahead of selected weekday |
| `scheduled_at` | `2026-06-02T08:00:00.000Z` | Berlin **Tuesday** 10:00 (CEST); time is internally consistent with wrong date |
| `ingestion_source` | `recurring_rule` | |
| `rule_id` | *(rule uuid)* | |

**UTC vs Berlin on the occurrence instant:** `2026-06-01T22:00:00Z` → UTC date part **Monday**; Berlin civil date **Tuesday 00:00**. That is exactly the reported +1-day symptom.

### Winter (CET) — same class of bug

For `start_date = 2026-01-05` (Monday), first `BYDAY=MO` occurrence:

- UTC: `2026-01-05T23:00:00.000Z`
- Berlin `requested_date`: **`2026-01-06`** (Tuesday)

Offset is **not CEST-only**; any non-zero Berlin–UTC offset on midnight DTSTART produces the same pattern.

---

## Incorrect vs expected (summary)

| Stage | Expected (user selects Montag) | Actual (current code) |
| --- | --- | --- |
| UI `days[]` | `['MO']` | `['MO']` ✅ |
| DB `rrule_string` | `FREQ=WEEKLY;BYDAY=MO` | Same ✅ |
| RRule first MO in window | Berlin calendar Monday | UTC Monday 22:00/23:00 → **Berlin Tuesday** ❌ |
| `trips.requested_date` | `YYYY-MM-DD` = Monday | **Tuesday (+1 day)** ❌ |

---

## Ruling out hypothesis A and C

### A — Day-of-week indexing

- UI uses **`MO`…`SU` strings**, not integers.
- DB stores **`BYDAY=MO`**, not `1` or `0`.
- Cron never calls `getDay()` / `getUTCDay()` on a stored weekday integer.
- **Verdict:** Ruled out.

### C — Off-by-one date arithmetic

- No `addDays(..., weekday)` or `setDay(..., n+1)` in the Regelfahrten chain.
- The shift is exactly **one Berlin calendar day** on every weekly occurrence, explained by **UTC occurrence time = Berlin next-day midnight**.
- **Verdict:** Ruled out as primary cause; the +1 is a **timezone side effect**, not a wrong increment.

---

## Senior assessment

### Most likely root cause

**Hypothesis B** — timezone boundary between **RRule (UTC `Z` DTSTART + UTC BYDAY)** and **business calendar (`Europe/Berlin` via `instantToYmdInBusinessTz`)**.

The Phase 2 fix correctly Berlin-aligned the search window and `dateStr` *conversion*, but **left DTSTART encoding in a form that makes `rrule` emit UTC-midnight-offset instants** that are **always one Berlin day ahead** for weekly rules anchored at local midnight.

This matches the user report precisely: every selected weekday appears **one day later** in Fahrten, year-round (CEST and CET).

### Minimal surgical fix (recommendation only — not implemented)

**Option 1 (smallest diff in cron only):** Build DTSTART with an explicit Berlin zone id instead of UTC `Z`:

```text
DTSTART;TZID=Europe/Berlin:20260601T000000
RRULE:FREQ=WEEKLY;BYDAY=MO
```

Local `rrule` simulation with this string yields occurrences whose **`instantToYmdInBusinessTz` = Monday** on the intended dates. Change is confined to **lines 495–504** in `generate-recurring-trips/route.ts` (replace UTC `format(..., 'Z')` DTSTART with `TZID=${getTripsBusinessTimeZone()}` + Berlin calendar date from `rule.start_date`).

**Option 2 (more explicit, slightly more code):** Drop `rrule.between()` for date selection; iterate Berlin calendar days in `[searchStart, searchEnd]`, parse `BYDAY` from `rrule_string`, and emit YMD strings directly. Removes dependency on RRule timezone semantics entirely; `buildScheduledAt` already handles wall times.

**Option 3 (avoid):** Keep UTC DTSTART but subtract a day in `instantToYmdInBusinessTz` — fragile, DST-unsafe, not recommended.

**Post-fix validation:** Manual cron run for a rule with **only `MO`**, assert `requested_date` weekday in Berlin matches `MO`; repeat in January (CET) and June (CEST). Check existing materialized rows for duplicate legs if correcting dates would change dedup keys (`client_id`, `rule_id`, `requested_date`, leg).

---

## Related docs

- `docs/plans/cron-trip-generation-audit.md` — pre–Phase 2 UTC issues (`toScheduledIso`, UTC `dateStr`); partially addressed since.
- `docs/trips-date-filter.md` — Berlin invariants for `buildScheduledAt`, `getZonedDayBoundsIso`, cron inventory.
- `docs/access-control.md` — manual cron trigger via `CRON_SECRET`.
