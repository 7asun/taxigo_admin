# Audit: `scheduled_at` write paths vs Fahrten read (Europe/Berlin)

**Scope:** Read-only mapping of every code path that **writes** or **mutates** `trips.scheduled_at`, compared to the **Fahrten** list/kanban filter in `trips-listing.tsx` + `getZonedDayBoundsIso` (`trip-business-date.ts`).  
**No code changes.**

---

## Context (confirmed in code)

- **Read path (Fahrten):** Half-open day windows in **`getTripsBusinessTimeZone()`** (default **`Europe/Berlin`**, override **`NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`**). See `src/features/trips/lib/trip-business-date.ts`.
- **Most write paths:** Build a JavaScript `Date` from **YYYY-MM-DD + time** using the **browser’s local timezone** (implicit `Date` constructor / `setHours` / `date-fns` `set` without a named zone), then persist **`toISOString()`** (UTC wire format). That **matches** Berlin **only** when the browser’s IANA zone is **Europe/Berlin** (or an equivalent offset that matches for the chosen local date/time).

---

## 1. Every place that writes or mutates `scheduled_at`

Below: **production** app and **cron**; **tests** and one-off **scripts** are listed separately. Line numbers refer to the workspace snapshot used for this audit.

### A. Core encoding helpers (no DB by themselves)

| File | Lines (approx.) | Behavior | TZ assumption |
|------|-----------------|----------|----------------|
| `src/features/trips/lib/departure-schedule.ts` | 18–58 | `combineDepartureForTripInsert`: `new Date(y, m-1, d, h, mi)` → `toISOString()`. | **Browser local** calendar + wall clock. |
| `src/features/trips/trip-detail-sheet/lib/apply-time-to-scheduled.ts` | 1–28 | `applyTimeToScheduledDate`: mutates `Date` from ISO with `setHours`/`setMinutes` (local). `buildScheduledAtFromYmdAndHm`: `new Date(y, mo-1, d)` + `setHours`. | **Browser local**. |
| `src/features/trips/lib/duplicate-trip-schedule.ts` | 52–177 | `wallClockHmInBusinessTz`, `computePreserveScheduleForLeg`, `combineYmdAndHmToIsoString`, `computeReturnScheduleForDuplicate`: use `tz(getTripsBusinessTimeZone())`, `startOfDay`, `setHours`/`setMinutes` with `{ in: inTz }`. | **Business TZ** (Berlin by default), **not** browser local. |
| `src/app/api/cron/generate-recurring-trips/route.ts` | 51–53, 288–290, … | `toScheduledIso`: `new Date(\`${dateStr}T${t}\`).toISOString()`. | **Server/runtime local** — on Vercel typically **UTC** (see cron audit). |

### B. Trips service (transport only — no transformation)

| File | Lines | Behavior | TZ assumption |
|------|-------|----------|----------------|
| `src/features/trips/api/trips.service.ts` | 42–51, 62–100 | `createTrip` / `bulkCreateTrips` / `updateTrip` pass the payload through to Supabase. | **None** — whatever the caller put in `scheduled_at`. Price recompute may read it but does not normalize zone. |

### C. Create / edit / return / reschedule (user flows)

| File | Lines (approx.) | Behavior | TZ assumption |
|------|-----------------|----------|----------------|
| `src/features/trips/components/create-trip/create-trip-form.tsx` | 1219–1251, 1293–1613 | Outbound: `combineDepartureForTripInsert(values.departure_date, values.departure_time)`. Return leg: `new Date(year, month, date, hh, mm).toISOString()`. | **Browser local** for both. |
| `src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts` | 183–232 | Uses `buildScheduledAtFromYmdAndHm` / `applyTimeToScheduledDate` → `patch.scheduled_at = …toISOString()`. | **Browser local**. |
| `src/features/trips/lib/build-return-trip-insert.ts` | 107 | `scheduled_at: params.scheduledAt.toISOString()`. | Whatever **`Date`** the caller supplies (see below). |
| `src/features/trips/lib/create-linked-return.ts` | 46–55 | `buildReturnTripInsert(outbound, { scheduledAt: options.scheduledAt })` → `createTrip`. | Inherits from `build-return-trip-insert`. |
| `src/features/trips/components/return-trip/create-return-trip-dialog.tsx` | 47–55, 139–144 | `defaultReturnDateTime`: `new Date()` / `new Date(outbound.scheduled_at)` + offset; user picks `Date` in `DateTimePicker`. Passed to `createLinkedReturnForOutbound`. | **Browser local** `Date` from UI and helpers. |
| `src/features/trips/trip-reschedule/api/reschedule.actions.ts` | 28–41, 108–112 | `rowFromLeg`: `leg.scheduledAt.toISOString()`. | Inherits from dialog (below). |
| `src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx` | 46–66, 68–85 | `parseLocalYmdHm` → `new Date(y, m-1, d, hh, mm, 0, 0)`. | **Browser local**. |

### D. Bulk import

| File | Lines (approx.) | Behavior | TZ assumption |
|------|-----------------|----------|----------------|
| `src/features/trips/components/bulk-upload-dialog.tsx` | 300–342, 900, 950 | `parseDateAndTime` → `scheduled_at: scheduled_at ? scheduled_at.toISOString() : null` on insert. | **`Date` built from CSV** (see inline parser): typically **local** components; same file comment block ~308–315. |

### E. Duplicate trip (API + lib)

| File | Lines (approx.) | Behavior | TZ assumption |
|------|-----------------|----------|----------------|
| `src/features/trips/lib/duplicate-trips.ts` | 330–362, 451–549 | `buildDuplicateInsert` sets `scheduled_at: schedule.scheduled_at` from `computeTimeOpenSchedule` / `unified_*` ISO / `computePreserveScheduleForLeg` / `computeReturnScheduleForDuplicate`. | **Mixed:** `duplicate-trip-schedule.ts` uses **business TZ** for preserve / `combineYmdAndHmToIsoString` / return delta; **`unifiedScheduledAtIso` from client** may be produced by UI using **Berlin** helpers in the duplicate dialog (see `duplicate-trips-dialog.tsx` + `combineYmdAndHmToIsoString`). **Not** a verbatim copy of source `scheduled_at` for **preserve_original_time** — it **recalculates** wall time on `targetDateYmd`. |
| `src/app/api/trips/duplicate/route.ts` | — | Calls `executeDuplicateTrips`; does not alter `scheduled_at` strings. | **None** at route layer. |

### F. Dashboard / dispatch widgets (client `updateTrip`)

| File | Lines (approx.) | Behavior | TZ assumption |
|------|-----------------|----------|----------------|
| `src/features/trips/components/pending-assignments/use-pending-assignments.ts` | 228–248 | Builds `localIso = \`${tripDate}T${timeString}:00\`` then `new Date(localIso).toISOString()`. | **Parsing** of `YYYY-MM-DDTHH:mm:ss` without `Z` is **implementation-defined** in practice (often **local** in browsers); comment ~241–243 claims localized parsing. |
| `src/features/dashboard/components/timeless-rule-trips-widget.tsx` | 84–96 | `set(new Date(pair.requested_date), { hours, minutes, … })` then `scheduledDate.toISOString()`. | **`new Date('yyyy-MM-dd')`** is **UTC midnight** in ECMAScript; `set` then applies **local** wall time — **mixed UTC date + local time** (high risk vs Berlin day). |
| `src/features/dashboard/components/pending-tours-widget.tsx` | 188–200 | `set(new Date(dateStr), { hours, minutes, … })` with `dateStr` from state (typically YMD). | Same **YMD → Date** pitfall as above if `dateStr` is plain `YYYY-MM-DD`. |

### G. Kanban (staged then saved)

| File | Lines (approx.) | Behavior | TZ assumption |
|------|-----------------|----------|----------------|
| `src/features/trips/components/kanban/kanban-trip-card.tsx` | 174–190 | `commitTimeToStore`: `baseDate` from `scheduledAt`, or `new Date(trip.requested_date + 'T12:00:00')`, or `new Date()`; `set(…, hours, minutes)` → `toISOString()` → `onTimeChange`. | **Browser local** `set` on the chosen base `Date` (note: `requested_date + 'T12:00:00'` is still **naïve-string** parsing). |
| `src/features/trips/components/kanban/kanban-board.tsx` | 462–493 | `handleSave`: `payload.scheduled_at = change.scheduled_at` → `tripsService.updateTrip`. | Persists whatever ISO the card produced (see above). |

### H. Server / cron (non-browser)

| File | Lines | Behavior | TZ assumption |
|------|-------|----------|----------------|
| `src/app/api/cron/generate-recurring-trips/route.ts` | 51–53, 288–606 | Inserts `scheduled_at` from `toScheduledIso` / null. | **UTC-leaning** server parse (see `docs/plans/cron-trip-generation-audit.md`). |

### I. Not mutating `trips.scheduled_at` for “edit trip” semantics (not listed in main risk table)

- `src/features/trips/trip-detail-sheet/lib/paired-trip-sync.ts` — `PAIRED_SYNC_COLUMN_KEYS` **excludes** `scheduled_at` (comments lines 19–22); paired dialog does **not** mirror schedule to partner via this module.
- Scripts (e.g. `scripts/backfill-trip-price-split.ts`) may **copy** `scheduled_at` for migration — not an interactive write path.

---

## 2. Return trip builder (`build-return-trip-insert.ts`)

**Answer:** `scheduled_at` is **`params.scheduledAt.toISOString()`** (line 107). There is **no** Europe/Berlin conversion in this file.

**Callers:** `create-linked-return.ts` passes through the `Date` from **`CreateReturnTripDialog`** (`DateTimePicker` + `defaultReturnDateTime`), i.e. a normal **browser `Date`** (local timezone semantics). **Not** UTC-literal strings, **not** explicitly Berlin unless the browser’s zone is Berlin.

---

## 3. Duplicate flow — copy vs recalculate

**Answer:** **Mostly recalculated**, not a blind copy of the source row’s `scheduled_at`.

- **`preserve_original_time`:** `computePreserveScheduleForLeg` (`duplicate-trip-schedule.ts` 60–76) takes the source leg’s **wall time in `getTripsBusinessTimeZone()`** and applies it to **`targetDateYmd`** on the business-TZ day start — then `toISOString()`.
- **`time_open`:** `scheduled_at: null`, `requested_date: targetDateYmd`.
- **`unified_time`:** Uses **`unifiedScheduledAtIso` / `unifiedReturnScheduledAtIso`** from the client payload (may be built with `combineYmdAndHmToIsoString` — Berlin) or omits time with `explicitPerLegUnifiedTimes`; return leg may use `computeReturnScheduleForDuplicate` (delta from instants, lines 170–176).

Verbatim copy appears only in the sense that **`unified_*` ISO strings** are stored as provided; those are **not** “copy source row” mode for schedule.

---

## 4. `getTripsBusinessTimeZone()` — export and usage at write time

**Answer:** **Yes**, it exists and is **exported** from `src/features/trips/lib/trip-business-date.ts` (lines 10–17).

It **can** be called from any client or server module: it reads **`process.env.NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE`** when defined, else **`Europe/Berlin`**. Because it is `NEXT_PUBLIC_*`, it is available in browser bundles.

**Current usage:** Heavily used in the **read** path (`getZonedDayBoundsIso`, `instantToYmdInBusinessTz`) and in **`duplicate-trip-schedule.ts`** for **duplicate** schedule math. It is **not** used in **`departure-schedule.ts`**, **`apply-time-to-scheduled.ts`**, **`build-trip-details-patch.ts`**, or **create-trip-form** for constructing `scheduled_at`.

---

## 5. Safest approach to unify writes to Berlin — and what imports exist

**Already in repo:** **`@date-fns/tz`** (`tz`, `startOfDay`, `setHours`, `setMinutes` with `{ in: inTz }`) as in `duplicate-trip-schedule.ts` and `trip-business-date.ts`. **No** `Temporal` usage found in the audited write helpers.

**Recommendation (audit level only):** Reuse the **same** pattern as `combineYmdAndHmToIsoString` / `computePreserveScheduleForLeg`: interpret every dispatcher-facing **calendar day + HH:mm** in **`getTripsBusinessTimeZone()`**, then emit **`toISOString()`** for Postgres. Avoid bare `new Date('YYYY-MM-DD')` for date-only strings in widgets (UTC midnight issue). **Manual offset** math is unnecessary if `@date-fns/tz` stays the single source of truth.

**Write-path imports today:** `departure-schedule` uses only `Date` / `date-fns` not tz. `apply-time-to-scheduled` — no `tz`. `build-trip-details-patch` imports `apply-time-to-scheduled` + `fetchDriving-metrics` only. **Duplicate** path already imports **`trip-business-date`** + **`@date-fns/tz`**.

---

## 6. Server-side validation / transformation before DB

**Answer:** **No** dedicated normalization of `scheduled_at` was found for general create/update:

- **`tripsService.createTrip` / `updateTrip`:** Direct Supabase client calls (`src/features/trips/api/trips.service.ts`).
- **`POST /api/trips/duplicate`:** Parses business fields with `parseDuplicateTripsPayload`; **does not** re-encode ISO instants to a zone — `executeDuplicateTrips` computes inserts in-process.
- **No** Supabase Edge Function in this audit’s path list for trip writes.
- **RLS** may restrict who can write; it does not change column values.

**Trip price engine** (`shouldRecalculatePrice` / `computeTripPrice`) may run on updates and **read** `scheduled_at` for pricing rules; it does not implement a global “force Berlin” transform in the reviewed code.

---

## Risk table: write site vs Berlin read path

| # | Write site | Current TZ / behavior | Matches Fahrten Berlin day? |
|---|------------|------------------------|----------------------------|
| 1 | `departure-schedule.ts` (create / bulk time) | Browser local | **Yes** iff browser zone == business TZ (often Berlin for in-house). |
| 2 | `build-trip-details-patch.ts` + `apply-time-to-scheduled.ts` | Browser local | Same as (1). |
| 3 | `create-trip-form.tsx` (outbound + return `Date`) | Browser local | Same as (1). |
| 4 | `build-return-trip-insert` + return dialog | Browser `Date` → ISO | Same as (1). |
| 5 | `trip-reschedule` (`parseLocalYmdHm`) | Browser local | Same as (1). |
| 6 | `use-pending-assignments` (`YYYY-MM-DDTHH:mm:ss`) | Naïve string → `Date` | **Mostly** local in browsers; verify cross-browser; not explicitly Berlin. |
| 7 | `timeless-rule-trips-widget` | `new Date(requested_date)` + `set` | **Risk:** UTC-midnight date + local time — **can diverge** from Berlin bucketing. |
| 8 | `pending-tours-widget` | `new Date(dateStr)` + `set` | **Risk:** same YMD parsing issue as (7). |
| 9 | Kanban time edit | `set` on mixed bases | **Mostly** local; `requested_date` base uses naïve `T12:00:00` string. |
|10| `duplicate-trip-schedule` (preserve / combine) | **`getTripsBusinessTimeZone()`** | **Aligned** with Fahrten read / `trip-business-date`. |
|11| Duplicate `unified_*` ISO from client | Depends on dialog | **Aligned** if UI uses `combineYmdAndHmToIsoString`; if a raw ISO is sent from elsewhere, **may not** be. |
|12| Cron `toScheduledIso` | Server **UTC** parse | **Misaligned** vs Berlin intent (see cron audit). |

---

## Files read completely (per request)

- `src/features/trips/lib/departure-schedule.ts`
- `src/features/trips/trip-detail-sheet/lib/apply-time-to-scheduled.ts`
- `src/features/trips/trip-detail-sheet/lib/build-trip-details-patch.ts`
- `src/features/trips/api/trips.service.ts`
- `src/features/trips/lib/build-return-trip-insert.ts`
- `src/features/trips/lib/duplicate-trips.ts` (substantive + schedule sections)
- `src/features/trips/lib/trip-business-date.ts`

Additional files were read to complete the **full write map** (grep + `create-trip-form`, `duplicate-trip-schedule`, reschedule, kanban, widgets, cron, return-trip flow).

---

## Summary

The **Fahrten** schedule is **Berlin-bounded** (`trip-business-date.ts`). The **default create/edit/kanban/reschedule** stack uses **browser-local** `Date` math and is **safe** only when the user’s browser timezone matches the business region. **Duplicate’s** preserve/combine path is a **positive exception** (business TZ). **Cron** and **some dashboard widgets** introduce **additional** mismatch risk (server UTC; `Date('YYYY-MM-DD')` parsing). Unifying writes would mean using **`getTripsBusinessTimeZone()`** + **`@date-fns/tz`** (or equivalent) at **every** user-facing schedule write, not only duplicates.
