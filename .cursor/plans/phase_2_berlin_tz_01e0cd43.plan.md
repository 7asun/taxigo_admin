---
name: Phase 2 Berlin TZ
overview: "Align four server-side paths with Europe/Berlin semantics: driver Touren date filter (half-open bounds), recurring-trip cron (buildScheduledAt + Berlin \"today\" window + Berlin dateStr + dedup fix), and two dashboard widgets (buildScheduledAtOrNull). Dedup must change before toScheduledIso changes to avoid duplicate inserts."
todos:
  - id: dedup-insertIfAbsent
    content: Change findExistingRecurringLegId / insertIfAbsent to drop scheduled_at from dedup key and query
    status: completed
  - id: driver-bounds
    content: "getDriverTrips: getZonedDayBoundsIso + gte/lt half-open"
    status: completed
  - id: cron-time
    content: "Cron: buildScheduledAt, Berlin today/window, instantToYmdInBusinessTz for dateStr, align rule/search TZ if bundled"
    status: completed
  - id: widgets
    content: "timeless + pending widgets: buildScheduledAtOrNull + TripTimeError toast"
    status: completed
  - id: qa-docs
    content: bun build + bun test; phase-2-verification.md; trips-date-filter.md; audit status Phase 2 complete
    status: completed
isProject: false
---

# Phase 2 — Berlin day correctness (server + widgets)

## Step 1 — `insertIfAbsent` / dedup (analyze first; then implement)

[`findExistingRecurringLegId`](src/app/api/cron/generate-recurring-trips/route.ts) (lines 301–330) currently dedupes using:

- `client_id`, `rule_id`, `requested_date` (always)
- **`scheduled_at`**: exact `.eq('scheduled_at', q.scheduled_at)` when non-null, else `.is('scheduled_at', null)`
- **Leg**: outbound → `link_type is null OR outbound`; return → `link_type = return`

**Answers (for implementer notes — not committed as a code comment block per repo convention; optionally a short `//` rationale next to the dedup change):**

1. **Uniqueness:** `scheduled_at` **is** part of the lookup for timed legs (exact instant match). It is not redundant with `requested_date` alone.
2. **After `toScheduledIso` fix:** Example `10:00` Berlin CEST → **`2026-05-11T08:00:00.000Z`** vs legacy wrong **`2026-05-11T10:00:00.000Z`**. The `.eq('scheduled_at', ...)` on the **new** value will **not** find the old row → **`insertIfAbsent` will insert a duplicate** for every affected rule/day/leg unless dedup changes.
3. **Recommendation — option (a):** **Stop matching on `scheduled_at` in `findExistingRecurringLegId`.** Keep `client_id`, `rule_id`, `requested_date`, and the existing `link_type`/`leg` branching. Rationale: cron produces **at most one outbound and one return per rule per `requested_date`** in normal operation; timed vs timeless is already implied by the payload and does not need a second instant key for uniqueness. **Do not** choose (b) in this phase (explicitly out of scope). **(c)** (Berlin-normalized compare) is heavier, couples DB reads to clock parsing, and is unnecessary if (a) holds.

**Implementation:** Remove the `if (q.scheduled_at === null) ... else ...` branch from the query; drop `scheduled_at` from the `dedupKey` type and from `insertIfAbsent` call sites (keys are only used for this lookup). Apply this **before** replacing `toScheduledIso`.

**Residual risk (document in PR / verification):** If the DB already contains **two** malformed rows for the same `(client_id, rule_id, requested_date, leg)`, `maybeSingle()` may error — acceptable edge case; fixing duplicates is ops/DB cleanup, not Phase 2 scope.

---

## Step 2 — Driver portal: Touren date filter

File: [`driver-trips.service.ts`](src/features/driver-portal/api/driver-trips.service.ts)

**In scope (per spec):** Only the `options?.date` branch (lines 89–92).

- Import `getZonedDayBoundsIso` from [`trip-business-date.ts`](src/features/trips/lib/trip-business-date.ts).
- Replace `dayStart = \`${options.date}T00:00:00.000Z\`` / `dayEnd` / closed `lte` range with:
  - `{ startISO, endExclusiveISO } = getZonedDayBoundsIso(options.date)`
  - `query.gte('scheduled_at', startISO).lt('scheduled_at', endExclusiveISO)` (half-open `[start, end)` — same as Fahrten).
- Add a one-line **why** comment: UTC-midnight bounds misplace late-evening Berlin trips (e.g. production “Leon” class of bugs).

**Explicitly out of this step (per “only touch…”):** [`getTodaysTrips`](src/features/driver-portal/api/driver-trips.service.ts) still uses **device-local** calendar boundaries (lines 32–43). If product wants Startseite aligned with Berlin too, that is a **separate** small follow-up unless you expand scope.

**Build:** `bun run build`.

---

## Step 3 — Cron: `toScheduledIso`, “today”, `dateStr`, + related Berlin consistency

File: [`generate-recurring-trips/route.ts`](src/app/api/cron/generate-recurring-trips/route.ts)

1. **Dedup:** As in Step 1 (remove `scheduled_at` from lookup and from `dedupKey`).

2. **3a `toScheduledIso`:** Delete the `new Date(\`${dateStr}T${t}\`)` helper; `import { buildScheduledAt } from '@/features/trips/lib/trip-time'` and use `buildScheduledAt(dateStr, clockToHhMmSs(timeHhMmSs))` (or equivalent — `clockToHhMmSs` output is already `HH:mm` or `HH:mm:ss`, which `normalizeHm` accepts).

3. **3b `todayLocal` / window:** Replace `startOfDay(new Date())` and the `addDays`/`endOfDay` chain with the same **business-TZ** pattern as [`trip-business-date.ts`](src/features/trips/lib/trip-business-date.ts): `import { tz } from '@date-fns/tz'`, `const inTz = tz(getTripsBusinessTimeZone())`, then e.g. `const todayLocal = startOfDay(inTz(Date.now()), { in: inTz })`, `const windowEndLocal = endOfDay(addDays(todayLocal, 14, { in: inTz }), { in: inTz })`. Reuse `getTripsBusinessTimeZone()` from `trip-business-date` (no hardcoded `Europe/Berlin`).

4. **3c `dateStr` from RRule occurrence (~478):** Replace `dateUTC.toISOString().split('T')[0]` with **Berlin calendar YMD** for that instant, e.g. `instantToYmdInBusinessTz(dateUTC.getTime())` from `trip-business-date` (single source of truth, no duplicated tz string).

5. **Strongly recommended in the same PR (same root cause, still “timezone handling” only):** Normalize **rule start** and **search window** construction that still uses `startOfDay(new Date(rule.start_date))`, `Date.UTC(...)`, and `searchStartUTC`/`searchEndUTC` built from `.getFullYear()`/`.getMonth()`/`.getDate()` — on Vercel these mix **UTC-calendar** with “local” dates. Align with `inTz` + `startOfDay` / `format(..., { in: inTz })` so occurrence iteration and exception date filters stay consistent with Berlin. If you **only** change lines 90–91 and 478 without fixing `dtStart`/`searchStartUTC`, you may still emit wrong occurrence sets for some rules; treating this as inseparable from Phase 2 correctness is the safer default.

6. **Imports:** Add `getTripsBusinessTimeZone`, `instantToYmdInBusinessTz` (and any Berlin helpers you use for the rule/window fix) from `trip-business-date`; add `buildScheduledAt` from `trip-time`.

7. **Comments:** Short **why** on each changed block (UTC runtime vs Berlin intent).

**Build:** `bun run build`.

---

## Step 4 — Dashboard widgets

### [`timeless-rule-trips-widget.tsx`](src/features/dashboard/components/timeless-rule-trips-widget.tsx)

- In `handleSave`, replace `set(new Date(pair.requested_date), { hours, minutes, ... })` + `toISOString()` with **`buildScheduledAtOrNull(pair.requested_date, \`${hours}:${minutes}\`)`** (or pad hours/minutes if you need `HH:mm` — `input type="time"` normally yields `HH:mm`).
- Guard: if the result is `null` despite non-empty time, show toast (should not happen for valid HH:mm).
- **`try/catch`:** Wrap `buildScheduledAt` errors (`TripTimeError`) and show toast; do not silently fall back.
- Remove unused `set` from `date-fns` import if nothing else uses it.

### [`pending-tours-widget.tsx`](src/features/dashboard/components/pending-tours-widget.tsx)

- In `handleSetTime`, replace `set(new Date(dateStr), {...})` with **`buildScheduledAtOrNull(dateStr, time)`** (already `HH:mm`).
- Same `try/catch` / toast pattern for `TripTimeError`.
- Remove unused `set` import.

**Explicitly untouched (per scope):** `initialDate.toISOString().slice(0, 10)`, `format(new Date(...))` display paths — deferred.

**Build:** `bun run build`.

---

## Step 5 + final docs

- **`bun test`** — full suite (75+).

- **`docs/plans/phase-2-verification.md`:** Implementer fills checklist results after manual runs ([driver Touren](/driver/touren), cron with secret, dedup double-run, widget saves, Fahrten). If not run locally, mark items **Skipped** with date.

- **Update [`docs/trips-date-filter.md`](docs/trips-date-filter.md):** New subsection **Phase 2 write paths**: list callers now using **`trip-time.ts`** (cron `buildScheduledAt`, widgets `buildScheduledAtOrNull`) vs **`trip-business-date` / `getZonedDayBoundsIso`** (driver Touren filter, cron window / `instantToYmdInBusinessTz` if used).

- **Update [`docs/plans/trip-time-utility-audit.md`](docs/plans/trip-time-utility-audit.md)** status header to **Phase 2 complete**.

---

## Files changed (only these four + docs above)

| File | Change |
|------|--------|
| [`src/features/driver-portal/api/driver-trips.service.ts`](src/features/driver-portal/api/driver-trips.service.ts) | Half-open Berlin bounds for `options.date` |
| [`src/app/api/cron/generate-recurring-trips/route.ts`](src/app/api/cron/generate-recurring-trips/route.ts) | Dedup + Berlin today/window + `buildScheduledAt` + Berlin `dateStr` (+ aligned rule/search TZ if implemented) |
| [`src/features/dashboard/components/timeless-rule-trips-widget.tsx`](src/features/dashboard/components/timeless-rule-trips-widget.tsx) | `buildScheduledAtOrNull` for persisted `scheduled_at` |
| [`src/features/dashboard/components/pending-tours-widget.tsx`](src/features/dashboard/components/pending-tours-widget.tsx) | Same |

**Non-goals:** No edits to [`trip-time.ts`](src/features/trips/lib/trip-time.ts); no migrations / backfills; no changes to deferred client paths (`departure-schedule`, create form, etc.).
