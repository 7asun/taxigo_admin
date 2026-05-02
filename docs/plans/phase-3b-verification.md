# Phase 3B verification — remaining writes + timeless query

## Summary

| Gate | Result |
|------|--------|
| `bun test` | **81 pass**, 0 fail |
| `bun run build` (final, smoke route removed) | **exit 0** |

---

## Step 1 — grep audit (classification)

Representative `src/features/trips/**` targets (excluding `__tests__`, `trip-time.ts` where noted):

| File | Line / area | Pattern | Write vs read | Fixed in 3B? | 3B / skip |
|------|-------------|---------|---------------|--------------|-----------|
| `apply-time-to-scheduled.ts` | helpers | `buildScheduledAt` / `parseScheduledAt` | Write helper + **render-safe** dirty | **Yes** | **3B** |
| `build-trip-details-patch.ts` | `scheduled_at` | `buildScheduledAt` ISO | **Write** | **Yes** | **3B** |
| `trip-detail-sheet.tsx` | save handler | `TripTimeError` → toast | Submit path | **Yes** | **3B** |
| `trip-reschedule-dialog.tsx` | `buildLeg` | `buildScheduledAt` | **Write** | **Yes** | **3B** |
| `reschedule.actions.ts` | `rowFromLeg` | `toISOString()` | Persist from dialog `Date` | N/A (upstream) | **3B** (comment) |
| `reschedule-trip.ts` | delta branch | UTC delta on instants | Delta math | N/A | **Skip** (comment only) |
| `kanban-trip-card.tsx` | `commitTimeToStore` | `buildScheduledAt` | **Write** | **Yes** | **3B** |
| `use-pending-assignments.ts` | `handleAssign` | `buildScheduledAt` | **Write** | **Yes** | **3B** |
| `duplicate-trips-dialog.tsx` | imports | `duplicate-trip-schedule` | Delegates | Already zoned | **Skip** |
| `duplicate-trip-schedule.ts` | — | Berlin zoned | **Write** | Correct | **Skip** (hard rule) |
| `bulk-upload-dialog.tsx` | CSV | browser-local | **Write** | No | **Post-3B gap** |
| `use-upcoming-trips.ts` | window | local bounds | **Read** | No | **Post-3B gap** |
| Various services / print / pairing | — | filters / display | **Read / non-create** | — | **Skip** (audit doc) |

---

## Step 2 — Timeless hook (root cause + fix)

**Data source:** `use-timeless-rule-trips.ts` → `fetchTimelessRulePairs`, not the widget file.

**Bug A:** `tomorrow` from `format(addDays(new Date(), 1), 'yyyy-MM-dd')` used **device-local** midnight, not Berlin operations day.

**Bug B:** Single `.eq('requested_date', …)` meant **Berlin “today”** timeless rows were never in scope.

**Fix:** `todayYmdInBusinessTz()` + `instantToYmdInBusinessTz(addDays(ymdToPickerDate(todayYmd), 1).getTime())`, query **`.in('requested_date', [todayYmd, tomorrowYmd])`**, query key `tripKeys.timelessRuleTrips(todayYmd, tomorrowYmd)`.

---

## Smoke route `GET /api/debug/phase3b-check`

- **Added** at `src/app/api/debug/phase3b-check/route.ts` for one build: `requireAdmin()`, service-role Supabase query mirroring the timeless filter (scoped by `company_id`), `editSheetGolden` via `buildScheduledAt('2026-06-15','10:00')`, and `serverTimezone` (`TZ`, `getTripsBusinessTimeZone()`, Node version).
- **`curl` without auth** against a running dev server (`http://127.0.0.1:3000/api/debug/phase3b-check`): **HTTP 401** body `{"error":"Unauthorized"}` — confirms handler + guard.
- **Route deleted** before final production build (no `/api/debug/phase3b-check` in shipped routes).
- **Full JSON** (counts, `clientNames`, `testVonHusseinVisible`, golden match) requires an **authenticated admin** session cookie plus server env `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_URL`; dev DB may return **zero rows** — `testVonHusseinVisible` may be false.

---

## Explicit checks

### (a) `applyTimeToScheduledDate` contains an in-function `TripTimeError` catch

Implementation: `src/features/trips/trip-detail-sheet/lib/apply-time-to-scheduled.ts` — `try { parseScheduledAt; buildScheduledAt }` / `catch (e)` with `e instanceof TripTimeError` → `return new Date(scheduledIso)` so **`detailsDirty` render cannot throw** on bad partial time input.

### (b) Timeless widget copy audit (strings only)

File: `src/features/dashboard/components/timeless-rule-trips-widget.tsx`

| Location | After (accurate for today + tomorrow) |
|----------|----------------------------------------|
| `description` `useMemo` (empty + count) | “heute oder morgen” / “heute und morgen” |
| Empty list paragraph | “heute oder morgen ohne Zeit” |

---

## Duplicate dialog

**Confirmed:** `duplicate-trips-dialog.tsx` has **no** independent `scheduled_at` ISO builder beyond `duplicate-trip-schedule.ts` imports — **no file changes** per plan.
