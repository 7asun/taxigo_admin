# Trips list & Kanban — date filter (`scheduled_at`)

This document explains how the **Fahrten** page decides which trips to load when a date (or range) is selected, and **why** the query was changed.

**Implementation:** `src/features/trips/components/trips-listing.tsx`  
**Related:** [Kanban view](./kanban-view.md) (uses the same query when `view=kanban`)  
**List sort (`?sort=`):** [`src/features/trips/trips-sort-map.ts`](../src/features/trips/trips-sort-map.ts) — maps sort column ids to PostgREST `order()`; orthogonal to the date filter.

---

## What went wrong (the “stuck cards” problem)

### Symptom

In **Kanban** (and Liste), changing the calendar day often **did not** change the set of cards: many trips seemed to **persist** no matter which day was selected. That looked like a React refresh bug or localStorage issue.

### Actual root cause (server query)

The Supabase filter for a selected day used logic equivalent to:

```text
(scheduled_at falls on the selected day)  OR  (scheduled_at IS NULL)
```

Any trip with **no** `scheduled_at` (`NULL`) matched the **second** branch. That is **independent of the selected date**, so **every** unscheduled trip in the database was returned **for every** day the user picked.

So the UI was doing what the query asked: those cards were **supposed** to appear on every date. It felt “stuck” because it violated the mental model: *“this day’s board should only show this day’s work.”*

### What we did not fix (for clarity)

- This was **not** primarily caused by Kanban **localStorage** (`pendingChanges`). Pending only **overrides** fields for trips **already** returned by the server; it cannot invent rows that the query did not return.
- **Separate** issues (addressed elsewhere): soft navigation + RSC cache (`router.refresh()`), `await searchParamsCache.parse` in the listing, and `key` on `TripsKanbanBoard` so the client remounts when filters change.

---

## Current behaviour (after the fix)

For an active `scheduled_at` URL param, the query combines:

1. **Scheduled trips** — `scheduled_at` inside the chosen window (single day, range, or open-ended bound).
2. **Unscheduled trips** — `scheduled_at IS NULL`, but **scoped** with `requested_date`:
   - **Single day:** `requested_date` equals that calendar day (`YYYY-MM-DD`), **or** (see backlog below).
   - **Range:** `requested_date` between the range’s start and end calendar dates (inclusive).
   - **Open start / open end:** unscheduled rows with `requested_date` on the appropriate side of the bound.

### Backlog: both `scheduled_at` and `requested_date` are NULL

Imports or drafts sometimes have **neither** time nor requested day. Those rows cannot be tied to a specific picker day.

We only add them when the **selected filter day** matches **today’s calendar date in the business timezone** (see below), not the raw UTC date of the host.

### Business timezone (production-safe)

Day boundaries and “today” use a single **IANA timezone** (default `Europe/Berlin`), not the Node process timezone (often UTC on Vercel). Implementation:

- **`src/features/trips/lib/trip-business-date.ts`** — `getZonedDayBoundsIso(ymd)`, `instantToYmdInBusinessTz(ms)`, `todayYmdInBusinessTz()` using `@date-fns/tz`.
- **`scheduled_at` URL values** are canonical **`YYYY-MM-DD`** strings for single-day and week-jump filters. Legacy **numeric ms** values are still accepted: they are mapped to a calendar day **in the business TZ**, then the same bounds apply.

Optional env: `NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE` (defaults to `Europe/Berlin`). Set on Vercel if operations use another region.

### Canonical read vs write helpers

**Reads (which trips belong to which calendar day in the planner):** use [`src/features/trips/lib/trip-business-date.ts`](../src/features/trips/lib/trip-business-date.ts) — especially `getZonedDayBoundsIso`, `instantToYmdInBusinessTz`, and `getTripsBusinessTimeZone()` so day windows do not rely on UTC midnight or browser-local TZ.

**Writes (turning dispatcher date + clock into stored `scheduled_at`):** canonical module is [`src/features/trips/lib/trip-time.ts`](../src/features/trips/lib/trip-time.ts). Public API: `buildScheduledAt(ymd, hm, timeZone?)`, `buildScheduledAtOrNull(...)`, `parseScheduledAt(iso, timeZone?)`, `TripTimeError`.

### Phase 2 server / widget paths (shipped)

| Callsite | Helper |
|----------|--------|
| [`src/app/api/cron/generate-recurring-trips/route.ts`](../src/app/api/cron/generate-recurring-trips/route.ts) | `buildScheduledAt`; Berlin “today” + window via `tz(getTripsBusinessTimeZone())`; RRule `between()` window from `getZonedDayBoundsIso`; occurrences → `instantToYmdInBusinessTz`; dedup without `scheduled_at` so correcting UTC encoding does not double-insert. **DTSTART** uses `TZID=${getTripsBusinessTimeZone()}` so RRule evaluates `BYDAY` in Berlin civil time — do not revert to UTC `Z` encoding. |
| [`src/features/dashboard/components/timeless-rule-trips-widget.tsx`](../src/features/dashboard/components/timeless-rule-trips-widget.tsx) | `buildScheduledAtOrNull` (+ `TripTimeError` toast) |
| [`src/features/dashboard/components/pending-tours-widget.tsx`](../src/features/dashboard/components/pending-tours-widget.tsx) | `buildScheduledAtOrNull` (+ `TripTimeError` toast) |
| [`src/features/driver-portal/api/driver-trips.service.ts`](../src/features/driver-portal/api/driver-trips.service.ts) `getDriverTrips` date branch | `getZonedDayBoundsIso` → half-open `gte` / `lt` on `scheduled_at` |

### Phase 3A — dispatcher create flow (shipped)

| Callsite | Helper |
|----------|--------|
| [`src/features/trips/lib/departure-schedule.ts`](../src/features/trips/lib/departure-schedule.ts) `combineDepartureForTripInsert` | `buildScheduledAt(ymd, hm)` for outbound `scheduled_at` (replaces browser-local `Date` + `toISOString()`); invalid input throws `TripTimeError` |
| [`src/features/trips/components/create-trip/create-trip-form.tsx`](../src/features/trips/components/create-trip/create-trip-form.tsx) return leg (`return_mode === 'exact'`) | `buildScheduledAt(formatLocalYmd(return_date), return_time)`; submit handler treats `TripTimeError` with toast |
| [`src/features/trips/lib/build-return-trip-insert.ts`](../src/features/trips/lib/build-return-trip-insert.ts) | `scheduled_at: params.scheduledAtIso` — ISO must be pre-built with `buildScheduledAt` |
| [`src/features/trips/lib/create-linked-return.ts`](../src/features/trips/lib/create-linked-return.ts) + [`create-return-trip-dialog.tsx`](../src/features/trips/components/return-trip/create-return-trip-dialog.tsx) | Dialog derives civil `ymd` + `HH:mm` from `DateTimePicker`’s `Date`, then `buildScheduledAt` → `scheduledAtIso` into `createLinkedReturnForOutbound` |

**Known gap:** [`getTodaysTrips`](../src/features/driver-portal/api/driver-trips.service.ts) in that file still uses **device-local** day boundaries; intentionally out of Phase 2 scope (potential Phase 2b).

Further client writes (detail sheet, Kanban, pending, bulk CSV, duplicate internals) are **Phase 3B+** (see [`docs/plans/trip-time-utility-audit.md`](./plans/trip-time-utility-audit.md)).

### Phase 3B — remaining client writes + timeless query (shipped)

| Area | Files / behaviour |
|------|-------------------|
| **Trip detail sheet** | [`apply-time-to-scheduled.ts`](../src/features/trips/trip-detail-sheet/lib/apply-time-to-scheduled.ts): `applyTimeToScheduledDate` uses `parseScheduledAt` + `buildScheduledAt`; **`TripTimeError` caught inside the function** so render-time `detailsDirty` in [`trip-detail-sheet.tsx`](../src/features/trips/trip-detail-sheet/trip-detail-sheet.tsx) cannot crash the sheet. [`build-trip-details-patch.ts`](../src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts): PATCH `scheduled_at` via **`buildScheduledAt`** (ISO string). Submit: **`TripTimeError` → toast** on patch build. |
| **Reschedule (“Verschieben”)** | [`trip-reschedule-dialog.tsx`](../src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx): `buildLeg` uses **`buildScheduledAt`**; primary/partner field init and paired clock sync use **`parseScheduledAt`** / Berlin instants. [`reschedule-trip.ts`](../src/features/trips/trip-reschedule/lib/reschedule-trip.ts): **comment** — partner leg keeps **UTC delta** on instants (intentionally not re-derived via `buildScheduledAt`). [`reschedule.actions.ts`](../src/features/trips/trip-reschedule/api/reschedule.actions.ts): persisted ISO follows dialog `Date` from that contract. |
| **Kanban** | [`kanban-trip-card.tsx`](../src/features/trips/components/kanban/kanban-trip-card.tsx): `commitTimeToStore` → Berlin **`ymd`** (`parseScheduledAt` / `requested_date` / `todayYmdInBusinessTz`) + **`buildScheduledAt`**; **`TripTimeError` → toast**. |
| **Dispatch inbox** | [`use-pending-assignments.ts`](../src/features/trips/components/pending-assignments/use-pending-assignments.ts) (`useDispatchInbox`): `handleAssign` sets `scheduled_at` with **`buildScheduledAt`** + Berlin **`tripDate`**; **`TripTimeError` → toast**. |
| **Duplicate trips** | **Skipped** — [`duplicate-trips-dialog.tsx`](../src/features/trips/components/trips-tables/duplicate-trips-dialog.tsx) delegates to Berlin-zoned [`duplicate-trip-schedule.ts`](../src/features/trips/lib/duplicate-trip-schedule.ts); do not migrate that engine in this phase. |
| **Timeless rule trips (dashboard)** | [`use-timeless-rule-trips.ts`](../src/features/dashboard/hooks/use-timeless-rule-trips.ts): **`requested_date` in (Berlin today, Berlin tomorrow)** via `todayYmdInBusinessTz` + `instantToYmdInBusinessTz(addDays(ymdToPickerDate(today),1))`; fixes device-local “tomorrow” and missing-today scope. [`timeless-rule-trips-widget.tsx`](../src/features/dashboard/components/timeless-rule-trips-widget.tsx): user-visible copy updated to **heute und morgen** / **heute oder morgen**. |

Verification log: [`docs/plans/phase-3b-verification.md`](./plans/phase-3b-verification.md).

### Phase 4 — bulk CSV + regression guard (shipped)

| Area | Behaviour |
|------|-----------|
| **Bulk CSV upload** | [`bulk-upload-dialog.tsx`](../src/features/trips/components/bulk-upload-dialog.tsx): German date → canonical **`YYYY-MM-DD`** without browser-local `Date` for the civil label; `scheduled_at` via **`buildScheduledAt(ymd, hm)`** when a time column is present; **`TripTimeError`** surfaces as the same per-row **`invalid_datetime`** issue pattern as other parse failures. |
| **ESLint** | [`.eslintrc.trips-time-guard.json`](../.eslintrc.trips-time-guard.json): standalone config (see `package.json` script **`lint:trips-scheduled-at`**) — **`no-restricted-syntax`** (warn) on `src/features/trips/**` and `src/app/api/**` for chained **`new Date(…, ≥3 args).toISOString()`** and **`new Date(…).setHours` / `setMinutes`** on a `Date` literal — allow-listed: `trip-time.ts`, `duplicate-trip-schedule.ts`, `src/features/trips/lib/__tests__/**`. The default `eslint` CLI still loads [`.eslintrc.json`](../.eslintrc.json) (`next/core-web-vitals`); the guard runs with **`eslint --no-eslintrc -c .eslintrc.trips-time-guard.json`** so it does not hit the Next 16 + ESLint 8 legacy-config validator issue. |
| **Agent / contributor docs** | [`AGENTS.md`](../AGENTS.md) **Trips time system** invariant (verbatim): persisted `scheduled_at` only via **`buildScheduledAt` / `buildScheduledAtOrNull`**; filters via **`getZonedDayBoundsIso`**. |

Verification: [`docs/plans/phase-4-verification.md`](./plans/phase-4-verification.md).

### Phase 5 — Berlin calendar reads + delete cutoff + display helper (shipped)

| Area | Behaviour |
|------|-----------|
| **`parseScheduledAtOrFallback`** | [`src/features/trips/lib/trip-time.ts`](../src/features/trips/lib/trip-time.ts): safe Berlin `{ ymd, hm }` from `scheduled_at` ISO for display paths; returns `null` on invalid/missing input (no throw). |
| **Recurring rule hard-delete cutoff** | [`recurring-rules.service.ts`](../src/features/trips/api/recurring-rules.service.ts): `requested_date >= today` uses `todayYmdInBusinessTz()` instead of UTC `toISOString().split('T')[0]`. |
| **Dispatch inbox “Heute”** | [`use-pending-assignments.ts`](../src/features/trips/components/pending-assignments/use-pending-assignments.ts): `todayStr` and per-row `tripDate` use Berlin ymd via `todayYmdInBusinessTz` + `parseScheduledAtOrFallback` so client filter matches Fahrten. |
| **Upcoming trips widget** | [`use-upcoming-trips.ts`](../src/features/trips/hooks/use-upcoming-trips.ts): Heute / Morgen / Woche windows use `getZonedDayBoundsIso` + business-week `startOfWeek`/`endOfWeek` with `{ in: tz(getTripsBusinessTimeZone()) }`; inclusive day end for `.lte` via one ms before next-day start. |
| **Display defaults** | [`pending-assignment-item.tsx`](../src/features/trips/components/pending-assignments/pending-assignment-item.tsx), [`pending-tours-widget.tsx`](../src/features/dashboard/components/pending-tours-widget.tsx): replace UTC `toISOString().slice(0, 10)` on `scheduled_at` / linked leg with `parseScheduledAtOrFallback`. |
| **CI** | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs `bun run lint:trips-scheduled-at` (among install, test, build). |

Verification: [`docs/plans/phase-5-verification.md`](./plans/phase-5-verification.md).

---

## URL shape (`scheduled_at` query param)

| Shape | Meaning |
|--------|--------|
| `YYYY-MM-DD` | Single calendar day in the **business timezone**; server builds UTC `[start, end)` for `scheduled_at` and uses the same string for `requested_date`. |
| Numeric ms (legacy) | Mapped to `YYYY-MM-DD` in the business TZ, then same as above. |
| `from,to` (two numbers) | Range; each ms mapped to YMD in the business TZ; scheduled window is `[start of first day, start of day after last day)` in UTC. |

---

## Fields involved

| Column | Role |
|--------|------|
| `scheduled_at` | Actual appointment / dispatch time; primary for “this day’s” scheduled work. |
| `requested_date` | Intended day for unscheduled trips (e.g. CSV import); used to include unscheduled rows **only** for relevant days. |

---

## Changing this logic

If product wants **all** unscheduled trips visible on every day again, you would revert to a global `scheduled_at.is.null` OR branch — at the cost of the old “stuck” behaviour. Prefer explicit UX (e.g. “Unplanned” filter) instead.
