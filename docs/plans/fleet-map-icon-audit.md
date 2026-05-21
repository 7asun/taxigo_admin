# Audit: Driver Busy Status for Fleet Map Icon

**Date:** 2026-05-21  
**Mode:** Read-only (no code changes)  
**Scope:** Whether “driver has a passenger” vs “driver is free” can drive fleet map marker styling, and where that signal lives in the schema.

---

## Files reviewed

| File | Relevance |
| --- | --- |
| [`src/app/driver/startseite/page.tsx`](../../src/app/driver/startseite/page.tsx) | Thin wrapper → `StartseitePageContent` |
| [`src/features/driver-portal/components/startseite/shift-status-card.tsx`](../../src/features/driver-portal/components/startseite/shift-status-card.tsx) | Shift lifecycle (not Tour starten) |
| [`src/features/driver-portal/components/shared/driver-trip-card.tsx`](../../src/features/driver-portal/components/shared/driver-trip-card.tsx) | **Tour starten** handler |
| [`src/features/driver-portal/api/driver-trips.service.ts`](../../src/features/driver-portal/api/driver-trips.service.ts) | `startTrip` / `completeTrip` writes |
| [`src/features/driver-portal/api/shifts.service.ts`](../../src/features/driver-portal/api/shifts.service.ts) | `getActiveShift` — shift duty, not passenger |
| [`src/types/database.types.ts`](../../src/types/database.types.ts) | `trips`, `shifts`, `shift_events`, `live_locations` |
| [`src/lib/tracking/use-fleet-map.ts`](../../src/lib/tracking/use-fleet-map.ts) | Current fleet data source |
| [`docs/driver-portal.md`](../../driver-portal.md) | Trip + shift lifecycle |
| [`docs/driver-system.md`](../../driver-system.md) | Table overview |

---

## 1. What happens when a driver taps “Tour starten”?

**UI path:** `DriverTripCard` → confirm dialog → `handleConfirmStart()` in [`driver-trip-card.tsx`](../../src/features/driver-portal/components/shared/driver-trip-card.tsx) (lines 132–150).

**Before write:** Resolves optional active shift via `shiftsService.getActiveShift(driverId)` → `shifts.id`.

**Database writes** (via [`startTrip`](../../src/features/driver-portal/api/driver-trips.service.ts) lines 139–163):

| Order | Table | Column(s) | Value |
| --- | --- | --- | --- |
| 1 (required) | **`trips`** | `status` | `'in_progress'` |
| 1 | **`trips`** | `actual_pickup_at` | `new Date().toISOString()` |
| 2 (best-effort) | **`trips`** | `shift_id` | Active `shifts.id` if shift exists |

**Not updated on Tour starten:**

- **`shifts`** — no change to `shifts.status` (remains `active` or `on_break` if already on shift)
- **`shift_events`** — no new row (shift events are only for Schicht starten / Pause / Beenden)
- **`live_locations`** — tracking hook continues GPS upserts only; no busy flag written

**Conclusion:** “Tour starten” is a **trip status** change on **`trips`**, not a shift status and not a shift_event.

---

## 2. Column and values: “has passenger” vs “free”

The product does not use literal values `busy` / `free`. Dispatch “passenger on board / unterwegs” maps to **trip** state; “free” means **no active trip in progress** for that driver (shift may still be running).

### Trip busy signal (primary for fleet icon)

| Meaning | Table | Column | Value(s) |
| --- | --- | --- | --- |
| **Driver has passenger / on tour** | `trips` | `status` | **`in_progress`** (canonical in driver portal) |
| Legacy alias (admin/kanban) | `trips` | `status` | **`driving`** (same semantic as `in_progress` per [`trip-status.ts`](../../src/lib/trip-status.ts)) |
| **Driver free (no active tour)** | `trips` | `status` | Anything **other than** `in_progress` / `driving` for that driver’s current row |

**All trip `status` values used in the codebase** ([`trip-status.ts`](../../src/lib/trip-status.ts), [`trips.types.ts`](../../src/features/driver-portal/types/trips.types.ts)):

| Value | Typical meaning | Busy? |
| --- | --- | --- |
| `pending` | Open, no driver (admin) | Free |
| `open` | Alias for pending (legacy) | Free |
| `assigned` | Driver assigned (admin) | Free (not started) |
| `scheduled` | Planned (driver portal) | Free (not started) |
| **`in_progress`** | **Tour gestartet** | **Busy** |
| **`driving`** | Legacy alias | **Busy** |
| `completed` | Tour beendet | Free |
| `cancelled` | Storniert | Free |
| `no_show` | Listed in driver `TRIP_STATUSES` | Free |

**Related trip columns (not status, but useful):**

- `actual_pickup_at` — set when tour starts
- `actual_dropoff_at` — set on **Tour beenden** (`status` → `completed`)
- `shift_id` — links trip to shift when tour started; does not mean busy by itself

### Shift status (duty, not passenger)

| Table | Column | Values | Meaning |
| --- | --- | --- | --- |
| `shifts` | `status` | `active`, `on_break`, `ended` | On duty / pause / shift over |

[`SHIFT_STATUSES`](../../src/features/driver-portal/types.ts): `active` | `on_break` | `ended`.

A driver can be **`shifts.status = 'active'`** and still **free** (no trip in `in_progress`). A driver on **`on_break`** could still have an **`in_progress`** trip if they started a tour before pausing — the app does not auto-complete the trip on break.

### Shift events (audit trail only)

| Table | Column | Values |
| --- | --- | --- |
| `shift_events` | `event_type` | `shift_start`, `break_start`, `break_end`, `shift_end` |

These do **not** indicate passenger on board.

---

## 3. Is busy/free on `live_locations`?

**Phase 1 app behaviour:** No. [`use-driver-tracking.ts`](../../src/lib/tracking/use-driver-tracking.ts) upserts only:

`driver_id`, `company_id`, `lat`, `lng`, `speed_kmh`, `accuracy_m`, `updated_at`.

**Phase 1 migration** ([`20260520120000_live_locations.sql`](../../supabase/migrations/20260520120000_live_locations.sql)) does **not** add a operational busy column. Generated types may still show optional legacy `status` / `vehicle_id` on older databases — **nothing in `src/` writes them today**.

**For fleet map icons:** busy/free must come from a **join (or separate query)** to **`trips`**, e.g. existence of a row where:

```text
trips.driver_id = live_locations.driver_id
AND trips.status IN ('in_progress', 'driving')
AND trips.company_id = live_locations.company_id   -- tenant scope
```

Optional: restrict to “today” or non-terminal trips if product requires — not enforced in current `startTrip` logic.

---

## 4. Existing query or hook to reuse in `use-fleet-map.ts`?

| Mechanism | Location | What it returns | Reusable for fleet busy? |
| --- | --- | --- | --- |
| **`useFleetMap`** | [`use-fleet-map.ts`](../../src/lib/tracking/use-fleet-map.ts) | `live_locations` + `accounts` embed | **No** — no trip/shift status |
| **`shiftsService.getActiveShift(driverId)`** | [`shifts.service.ts`](../../src/features/driver-portal/api/shifts.service.ts) | One non-ended shift per driver | **Partial** — “on duty”, not “has passenger” |
| **`getTodaysTrips` / `getDriverTrips`** | [`driver-trips.service.ts`](../../src/features/driver-portal/api/driver-trips.service.ts) | Trips for **one** driver | Pattern only; not company-wide |
| **`useTracking` / `TrackingContext`** | [`tracking-context.tsx`](../../src/lib/tracking/tracking-context.ts) | GPS tracking state | **No** trip busy |
| **Admin trip hooks** | e.g. `useTrips`, kanban | Company trips | Different feature; no shared “driver busy map” hook |

**There is no existing hook** that returns “all company drivers + busy flag” for the fleet map.

**Closest reuse:**

- Query pattern from `getActiveShift`: `shifts` filtered by `driver_id`, `status != 'ended'`
- Busy definition from `startTrip`: `trips.status = 'in_progress'` (and `'driving'` for legacy rows)

**Implementation options for `use-fleet-map.ts` (future, not in this audit):**

1. Extend initial `.select()` with a nested embed or RPC (if PostgREST supports filter on embed)
2. Second query: `trips.select('driver_id').eq('company_id', …).in('status', ['in_progress','driving'])` → build `Set<driver_id>`
3. Denormalize `live_locations.busy` on tour start/end (would require app + migration changes)

Realtime: today `useFleetMap` subscribes to **`live_locations`** only. Trip status changes fire **`trips`** postgres_changes elsewhere — fleet map would **not** update busy icons until a second subscription or join refresh is added.

---

## 5. FK path from busy/free status to `accounts.id`

Both **`live_locations`** and busy signal anchor on the same identity:

```text
accounts.id
    ↑
    ├── live_locations.driver_id  (PK, 1:1 per driver)
    └── trips.driver_id           (many trips per driver)
            └── trips.status = 'in_progress' | 'driving'  → busy
```

**Declared FKs** ([`database.types.ts`](../../src/types/database.types.ts)):

| From | FK name | To |
| --- | --- | --- |
| `live_locations.driver_id` | `live_locations_driver_id_fkey` | `accounts.id` |
| `trips.driver_id` | `trips_driver_id_fkey` | `accounts.id` |
| `shifts.driver_id` | (shifts → accounts) | `accounts.id` |

**Join key for fleet map:** `live_locations.driver_id = trips.driver_id = accounts.id` (no extra hop).

**Shift link (optional):** `trips.shift_id` → `shifts.id` → `shifts.driver_id` → `accounts.id` — same driver, not required to detect busy.

---

## Senior recommendation

### For “passenger on board” icon

| Signal | Use? |
| --- | --- |
| **`trips.status IN ('in_progress', 'driving')`** | **Yes** — this is what Tour starten / Tour beenden change |
| `shifts.status = 'active'` | **No** — means on shift, not necessarily with passenger |
| `shift_events` | **No** — timeline only |
| `live_locations.status` | **No** — not written in Phase 1; legacy column only |

### Blockers / open questions

1. **Multiple `in_progress` trips** — not prevented in DB; UI assumes one active tour. Fleet icon logic should use `EXISTS` or `LIMIT 1`, not “exactly one row”.
2. **Realtime gap** — busy state changes on **`trips` UPDATE**; fleet map only listens to **`live_locations`**. Icon updates need `trips` subscription or polling unless busy is copied into `live_locations`.
3. **Legacy `driving`** — include in busy filter for admin/kanban parity.
4. **`on_break` + `in_progress`** — product decision: show busy icon during break while trip still open? Current data model says **yes** (trip stays `in_progress` until Tour beenden).

### Confidence

**High** that `trips.status` is the correct busy/free source. **Medium** for a clean fleet-map implementation without also subscribing to `trips` realtime or denormalizing into `live_locations`.

---

## Reference index

| Topic | Primary file |
| --- | --- |
| Tour starten write | `src/features/driver-portal/api/driver-trips.service.ts` → `startTrip` |
| Tour starten UI | `src/features/driver-portal/components/shared/driver-trip-card.tsx` |
| Shift vs trip | `docs/driver-portal.md` → Trip Lifecycle, Gating Tour starten |
| Trip status labels | `src/lib/trip-status.ts` |
| Fleet map today | `src/lib/tracking/use-fleet-map.ts` |
