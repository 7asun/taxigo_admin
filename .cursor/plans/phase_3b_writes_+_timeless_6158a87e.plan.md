---
name: Phase 3B writes + timeless
overview: Migrate remaining `scheduled_at` write paths (detail sheet helpers, reschedule dialog, Kanban time commit, dispatch inbox time assign) to `buildScheduledAt` / `parseScheduledAt`; fix timeless rule trips hook to load Berlin today and tomorrow via `.in('requested_date', …)`; skip duplicate dialog and duplicate-trip-schedule; add temporary smoke route then docs. Handle render-time `detailsDirty` without throwing.
todos:
  - id: step1-audit
    content: Run grep; produce Step 1 markdown table (for phase-3b-verification.md)
    status: completed
  - id: step2-notes
    content: Document timeless hook query + root cause + fix in notes / verification doc
    status: completed
  - id: timeless-hook
    content: "Hook+tripKeys: Berlin today+tomorrow .in(); timeless-rule-trips-widget.tsx — audit/update ALL morgen-only user strings"
    status: completed
  - id: build-3
    content: bun run build after timeless
    status: completed
  - id: edit-sheet
    content: "applyTimeToScheduledDate: TripTimeError catch INSIDE function; patch + sheet toast for submit"
    status: completed
  - id: build-4
    content: bun run build after edit sheet
    status: completed
  - id: reschedule
    content: trip-reschedule-dialog buildLeg + reschedule-trip delta comment
    status: completed
  - id: build-5
    content: bun run build after reschedule
    status: completed
  - id: kanban
    content: kanban-trip-card commitTimeToStore + toast
    status: completed
  - id: build-6
    content: bun run build after kanban
    status: completed
  - id: pending
    content: use-pending-assignments handleAssign buildScheduledAt + toast
    status: completed
  - id: build-7
    content: bun run build after pending
    status: completed
  - id: dup-skip
    content: Confirm duplicate-trips-dialog skip; build if needed
    status: completed
  - id: tests
    content: bun test + bun run build
    status: completed
  - id: smoke-route
    content: phase3b-check route, curl, delete, final build
    status: completed
  - id: docs-final
    content: trips-date-filter.md, trip-time-utility-audit.md, phase-3b-verification.md
    status: completed
isProject: false
---

# Phase 3B — Remaining writes + timeless query

## Step 1 — Grep audit (classification)

Run the user’s grep on `src/features/trips/**` excluding `__tests__`, `trip-time.ts`, `node_modules`, `.next`. Representative rows:

| File | Line / area | Pattern | Write vs read | Fixed already? | 3B / skip |
|------|----------------|---------|----------------|----------------|-----------|
| [apply-time-to-scheduled.ts](src/features/trips/trip-detail-sheet/lib/apply-time-to-scheduled.ts) | `setHours`, local `new Date(y,m,d)` | Wall-clock → `Date` | **Write path helper** (used for PATCH + dirty) | No | **3B** |
| [build-trip-details-patch.ts](src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts) | 185–231 | `buildScheduledAtFromYmdAndHm` + `toISOString`, `applyTimeToScheduledDate` | **Write** `scheduled_at` | No | **3B** |
| [trip-detail-sheet.tsx](src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx) | ~855 | `applyTimeToScheduledDate` in `detailsDirty` | **Read / dirty** (not persisted) | No | **3B** (must not throw in render) |
| [trip-reschedule-dialog.tsx](src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx) | `parseLocalYmdHm` | `new Date(y,m,d,h,m)` | **Write** (feeds `LegScheduleInput`) | No | **3B** |
| [reschedule.actions.ts](src/features/trips/trip-reschedule/api/reschedule.actions.ts) | `rowFromLeg` | `leg.scheduledAt.toISOString()` | **Persist** ISO from dialog `Date` | No | **3B** (fixed upstream when `Date` encodes correct instant) |
| [reschedule-trip.ts](src/features/trips/trip-reschedule/lib/reschedule-trip.ts) | 88–95 | `toISOString` on primary + **delta** on partner | **Delta math** | N/A | **Skip** — add comment per user |
| [kanban-trip-card.tsx](src/features/trips/components/kanban/kanban-trip-card.tsx) | `commitTimeToStore` | `set` + `toISOString` | **Write** (staged ISO) | No | **3B** |
| [use-pending-assignments.ts](src/features/trips/components/pending-assignments/use-pending-assignments.ts) | `handleAssign` ~241–247 | `new Date(localIso)` + `toISOString` | **Write** | No | **3B** (file exports `useDispatchInbox`) |
| [duplicate-trips-dialog.tsx](src/features/trips/components/trips-tables/duplicate-trips-dialog.tsx) | combineYmd imports | Delegates to [duplicate-trip-schedule.ts](src/features/trips/lib/duplicate-trip-schedule.ts) | **Write** via zoned helpers | Already Berlin-zoned | **Skip** — do **not** edit `duplicate-trip-schedule.ts` |
| [duplicate-trip-schedule.ts](src/features/trips/lib/duplicate-trip-schedule.ts) | setHours in `tz()` | Zoned | **Write** (duplicate engine) | Correct per audit | **Skip** (hard rule) |
| [bulk-upload-dialog.tsx](src/features/trips/components/bulk-upload-dialog.tsx) | parseDateAndTime / `toISOString` | Browser-local | **Write** | No | **Skip** (out of user’s five paths) → **Post-3B gap** |
| [use-upcoming-trips.ts](src/features/trips/hooks/use-upcoming-trips.ts) | `startOfDay`…`toISOString` | Query window | **Read** | No | **Skip** → Post-3B gap |
| [trips.service.ts](src/features/trips/api/trips.service.ts), [client-trips-panel.tsx](src/features/trips/components/client-trips-panel.tsx), [pending-assignment-item.tsx](src/features/trips/components/pending-assignments/pending-assignment-item.tsx), [recurring-exceptions.actions.ts](src/features/trips/api/recurring-exceptions.actions.ts), [print-trips-button.tsx](src/features/trips/components/print-trips-button.tsx), [duplicate-trips.ts](src/features/trips/lib/duplicate-trips.ts) | various | Filters / display / pairing | **Read / non-create** | — | **Skip** with reason in audit doc |

**Extra write path (in scope):** reschedule dialog + `reschedule.actions` `rowFromLeg` — listed under reschedule.

---

## Step 2 — Timeless widget / hook analysis (two bugs, not one)

**Where the query lives:** Not in [timeless-rule-trips-widget.tsx](src/features/dashboard/components/timeless-rule-trips-widget.tsx). Data comes from [use-timeless-rule-trips.ts](src/features/dashboard/hooks/use-timeless-rule-trips.ts) → `fetchTimelessRulePairs(requestedDate)`.

**Current query (essential):**

```ts
.from('trips')
.select(`*, requested_date, ${TIMELESS_TRIP_EMBEDS}`)
.not('rule_id', 'is', null)
.is('scheduled_at', null)
.eq('requested_date', requestedDate)
.not('status', 'in', '("cancelled","completed")');
```

**Filter:** Only `requested_date` (single day). `scheduled_at IS NULL`. `rule_id` present.

**Bug A — wrong calendar for “tomorrow”:** `tomorrowDateStr = format(addDays(new Date(), 1), 'yyyy-MM-dd')` is **device-local** midnight math, not Berlin. Near UTC midnight or non-Berlin browsers, the YMD string can be the wrong civil day vs operations.

**Bug B — single-day scope:** The hook only ever passes **one** `requestedDate` into `.eq('requested_date', …)`, so **`requested_date === today` (Berlin) is never fetched**. Only “tomorrow” (already wrong per Bug A) was in scope.

**Fix (both):** Compute `todayYmd = todayYmdInBusinessTz()` and `tomorrowYmd = instantToYmdInBusinessTz(addDays(ymdToPickerDate(todayYmd), 1).getTime())` using [trip-business-date.ts](src/features/trips/lib/trip-business-date.ts) (same pattern as [duplicate-trips-dialog.tsx](src/features/trips/components/trips-tables/duplicate-trips-dialog.tsx) `nextCalendarDayYmd`). Change `fetchTimelessRulePairs` to filter **`.in('requested_date', [todayYmd, tomorrowYmd])`** in one query. Update [src/query/keys/trips.ts](src/query/keys/trips.ts) `tripKeys.timelessRuleTrips(todayYmd, tomorrowYmd)` (stable pair). `timelessRuleTripsRoot` prefix invalidation unchanged.

**Widget copy (mandatory):** [timeless-rule-trips-widget.tsx](src/features/dashboard/components/timeless-rule-trips-widget.tsx) still uses **“morgen”** in multiple user-visible strings (`description` `useMemo`, empty filter text, empty list copy, etc.). After the data fix those strings are **factually wrong**. **Implementation must audit the full file** and replace every misleading “nur morgen” phrasing with accurate copy (e.g. **heute und morgen** / equivalent). No layout or styling changes—**strings only**.

**Build gate** after Step 3: `bun run build`.

---

## Step 3 — Implement timeless hook + key + copy

- Edit `fetchTimelessRulePairs` + `useTimelessRuleTrips` + `tripKeys.timelessRuleTrips` as above (fixes **Bug A + Bug B**).
- Edit [timeless-rule-trips-widget.tsx](src/features/dashboard/components/timeless-rule-trips-widget.tsx): **all** incorrect “morgen”-only user strings (confirm in PR / verification doc with line references).
- Add **why** comments on the hook query (device-local YMD + single `.eq` excluded Berlin today and could mis-label “tomorrow”).

---

## Step 4 — Edit sheet write paths

**Files:** [apply-time-to-scheduled.ts](src/features/trips/trip-detail-sheet/lib/apply-time-to-scheduled.ts), [build-trip-details-patch.ts](src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts).

**Hard requirement — render safety:** [`trip-detail-sheet.tsx`](src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx) calls **`applyTimeToScheduledDate` inside `detailsDirty` (render-time)**. If that function throws, the sheet crashes. Therefore the **`try/catch (TripTimeError)` MUST live inside `applyTimeToScheduledDate` in `apply-time-to-scheduled.ts`** — on failure return **`new Date(scheduledIso)`** (baseline instant) so dirty detection degrades safely. **Relying only on a catch in the submit handler is insufficient** and must not be the sole mitigation.

**Implementation:**

- `buildScheduledAtFromYmdAndHm`: implement as `return new Date(buildScheduledAt(dateYmd, timeHHmm))` — keeps **`Date` return type** (no exported signature change). Used from async `buildTripDetailsPatch` only (not from `detailsDirty`); may still throw — caught at submit via sheet `try/catch` below.
- `applyTimeToScheduledDate`: use `parseScheduledAt(scheduledIso)` for Berlin `ymd`, then **`try { return new Date(buildScheduledAt(ymd, timeHHmm)); } catch (e) { if (e instanceof TripTimeError) return new Date(scheduledIso); throw e; }`** — catch **inside this function body**, with a short **why** comment (render-time caller in `detailsDirty`).
- `build-trip-details-patch.ts`: set `patch.scheduled_at = buildScheduledAt(...)` — prefer **direct ISO string** from `buildScheduledAt`. Remove redundant `Date` round-trips where only ISO was needed.

**Toast (submit only, additional):** Wrap `await buildTripDetailsPatch(...)` in [trip-detail-sheet.tsx](src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx) `handleSaveTripDetails` / `exec` with `try/catch` on `TripTimeError` → `toast.error(...)`, return early (covers `buildScheduledAtFromYmdAndHm` / patch paths). **Verification:** In final output, cite that `apply-time-to-scheduled.ts` shows the in-function catch, not only `trip-detail-sheet.tsx`.

**Build gate:** `bun run build`.

---

## Step 5 — Reschedule flow

- [trip-reschedule-dialog.tsx](src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx): Replace `parseLocalYmdHm` body used by `buildLeg` with **`new Date(buildScheduledAt(ymdTrim, hmTrim))`** inside try/catch; toast on `TripTimeError`. Keep `LegScheduleInput` shape (`Date | null`).
- [reschedule-trip.ts](src/features/trips/trip-reschedule/lib/reschedule-trip.ts): Add a short **why** comment on `computePairedReschedule` delta branch — intentional UTC delta on instants; **do not** replace with `buildScheduledAt`.
- [reschedule.actions.ts](src/features/trips/trip-reschedule/api/reschedule.actions.ts): No change if `Date#toISOString()` is fed correct instants; optional one-line comment that encoding is defined by dialog + `buildScheduledAt`.

**Build gate:** `bun run build`.

---

## Step 6 — Kanban `kanban-trip-card.tsx`

- In `commitTimeToStore`, derive **Berlin `ymd`**: from `scheduledAt` use `parseScheduledAt` if present; else `trip.requested_date` string; else `todayYmdInBusinessTz()`.
- `buildScheduledAt(ymd, paddedHm)` → pass string to `onTimeChange`.
- Import `toast` + `TripTimeError`; catch and toast, do not call `onTimeChange` on failure.

**Build gate:** `bun run build`.

---

## Step 7 — `use-pending-assignments.ts` (`useDispatchInbox`)

- Replace `tripDate` derivation for **UTC slice** with **`instantToYmdInBusinessTz`** / `parseScheduledAt` where appropriate so `tripDate` is Berlin civil day.
- Replace `new Date(localIso).toISOString()` with **`buildScheduledAt(tripDate, timeString)`** (ensure `timeString` is `HH:mm`; normalize if needed).
- `try/catch TripTimeError` → `toast.error` in `handleAssign` (UI path).

**Note:** `todayStr` filter (lines ~73, 181) still uses `now.toISOString().slice(0, 10)` — **out of scope** per “only `scheduled_at` construction” unless you explicitly widen; if product needs Berlin “today” filter for inbox, add as **optional follow-up** in Post-3B gaps.

**Build gate:** `bun run build`.

---

## Step 8 — Duplicate dialog

- **Confirm:** [duplicate-trips-dialog.tsx](src/features/trips/components/trips-tables/duplicate-trips-dialog.tsx) has **no** independent `scheduled_at` ISO builder beyond `duplicate-trip-schedule.ts` imports.
- **Action:** **Skip** file changes.

**Build gate:** `bun run build` (should be no-op if nothing changed).

---

## Step 9 — Tests + build

- `bun test` — expect **81+** passes; **report** any failure before fixing.
- `bun run build` — exit 0.

---

## Step 10 — Temporary `phase3b-check` route (delete before done)

- Add [src/app/api/debug/phase3b-check/route.ts](src/app/api/debug/phase3b-check/route.ts) using service Supabase client (same env pattern as prior debug routes if present; else document manual run).
- **timelessWidgetCheck:** query `trips` with `scheduled_at is null`, `rule_id not null`, `requested_date in (todayBerlin, tomorrowBerlin)`, exclude cancelled/completed; return counts + `client_name`s; `testVonHusseinVisible` if any name contains substring (case-insensitive) or exact match per product — **document** if no rows in dev DB.
- **editSheetGolden:** `buildScheduledAt('2026-06-15','10:00')` vs expected `2026-06-15T08:00:00.000Z` **or** call fixed `buildScheduledAtFromYmdAndHm(...).toISOString()` — must match golden.
- **serverTimezone / nodeEnvTZ:** `process.env.TZ`, `Intl` or `getTripsBusinessTimeZone()` for response shape user asked.

`curl` → capture JSON → **delete route** → `bun run build`.

---

## Final docs (mandatory)

1. [docs/trips-date-filter.md](docs/trips-date-filter.md) — **Phase 3B** subsection: edit sheet, reschedule, Kanban, dispatch inbox, duplicate skip; timeless **query** fix (hook + Berlin two-day window).
2. Inline **why** comments on every changed write / query line.
3. [docs/plans/trip-time-utility-audit.md](docs/plans/trip-time-utility-audit.md) — mark Phase 3B rows shipped; status **“Phase 3B complete — all scoped write paths migrated”**; **Post-3B known gaps:** `getTodaysTrips` device-local; skipped grep hits (bulk upload, upcoming trips query, print ranges, duplicate-trips UTC slice, etc.); historical bad UTC rows.
4. New [docs/plans/phase-3b-verification.md](docs/plans/phase-3b-verification.md) — Step 1 table, smoke JSON, pass/fail summary, plus **explicit checks:** (a) `applyTimeToScheduledDate` contains in-function `TripTimeError` catch; (b) timeless widget copy audit — list updated string locations / before-after if helpful.

---

## Risk summary

| Risk | Mitigation |
|------|------------|
| `detailsDirty` throws on bad time input | **`applyTimeToScheduledDate` only:** in-file `try/catch TripTimeError` → return `new Date(scheduledIso)`; verify in implementation output, not only submit toast |
| Query key change breaks cache | Update `tripKeys.timelessRuleTrips` signature + single call site |
| Timeless UX lies after data fix | **Mandatory** string pass over [timeless-rule-trips-widget.tsx](src/features/dashboard/components/timeless-rule-trips-widget.tsx); confirm in verification doc |
| Smoke route DB-specific | `testVonHusseinVisible` may be false; document |
