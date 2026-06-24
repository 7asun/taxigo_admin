# v4d Phase 1: Return Leg Schedule Anchor Fix

Date: 2026-06-24

## Gap 1 — Bulk upload `buildReturnTrip`

**Root cause:** L539–540 explicitly nulled `requested_date` as a placeholder stub alongside `scheduled_at: null`.

**Fix:** Copy outbound Berlin calendar day — `outbound.requested_date ?? instantToYmdInBusinessTz(outbound.scheduled_at)`. `scheduled_at` stays null (return time TBD).

**File:** [`src/features/trips/components/bulk-upload-dialog.tsx`](../src/features/trips/components/bulk-upload-dialog.tsx)

**Status:** DONE

## Gap 2 — Manual return `buildReturnTripInsert`

**Root cause:** `requested_date` absent from insert object; only `scheduled_at` set.

**Fix:** Add `requested_date` from `instantToYmdInBusinessTz(scheduledAtIso)` with defensive guard when `scheduledAtIso` is falsy.

**File:** [`src/features/trips/lib/build-return-trip-insert.ts`](../src/features/trips/lib/build-return-trip-insert.ts)

**Status:** DONE

## Data repair

9 anchorless bulk-upload return stubs (2026-03-20 → 2026-03-27) repaired via migration `20260624120000_repair_anchorless_return_legs.sql`. `requested_date` copied from linked outbound calendar day; `scheduled_at` remains null.

**Status:** DONE (9 rows updated; post-repair anchorless count = 0)

## What is not fixed (Phase 2)

~~- Reschedule empty-submit guard~~ **DONE (Phase 2)**
~~- CHECK constraint on `trips` table~~ **DONE (Phase 2)**
- 268 timed rows with `requested_date = null` (intentional state — no backfill approved)

## Compatibility

No invalidation changes. No widget changes. No cron changes. v4b contract untouched.

---

## v4d Phase 2: Reschedule Guard + CHECK Constraint

Date: 2026-06-24

### Gap 3 — Reschedule both-blank submit

**Root cause:** `buildLeg` returns `{ scheduledAt: null, requestedDate: null }` when both date and time fields are empty. Submit was not blocked for this shape (v4d audit Q9).

**Fix (UI-only):** In [`trip-reschedule-dialog.tsx`](../src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx), added `primaryBothBlank` / `partnerBothBlank` guards to `submitDisabled`, inline error `"Bitte mindestens ein Datum angeben."` per leg, and updated help text to require at least a date (date-only + empty time = Zeitabsprache remains valid). No changes to `buildLeg`, `legToPatch`, or `reschedule.actions.ts`.

**Status:** DONE

### CHECK constraint

**Migration:** `20260624140000_trips_schedule_anchor_check.sql`

**Constraint:** `trips_schedule_anchor_check` — `scheduled_at IS NOT NULL OR requested_date IS NOT NULL`

**Pre-apply verify:** anchorless count = 0 (Phase 1 repair held)

**Status:** APPLIED

### v4d fully closed

Phase 1 (return leg anchors + data repair) and Phase 2 (reschedule guard + DB constraint) complete. Schedule anchor invariant enforced at write paths and database level.
