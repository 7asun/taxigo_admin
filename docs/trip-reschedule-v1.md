# Trip reschedule (“Verschieben”) — v1

## Purpose

Allow dispatchers to change the planned pickup time (and date) for a **single, non-recurring** trip without cancelling and re-creating it. Entry points:

- **Trips table** — row menu (**Verschieben**).
- **Trip detail sheet** — **Verschieben** in the footer.

## v1 behaviour

- **Eligibility**: Trip must have either `scheduled_at` or `requested_date` (so there is something to reschedule), must not be `completed` or `cancelled`, and must **not** have `rule_id` (non-recurring only).
- **Linked legs** (`linked_trip_id` / `link_type`): The paired trip is resolved with `findPairedTrip()` (same helper as cancellation). The dialog shows **Neue Abholzeit** and, when a partner exists, a second row labeled **Rückfahrt** / **Hinfahrt** / **Verknüpfte Fahrt** from `getTripDirection()`, each with separate **date** and **time** inputs.
- **Default sync**: On open, baseline `scheduled_at` values are stored when present. Changing the primary **date + time** shifts the linked leg by the **same ms delta** (gap preserved) until the user edits the linked leg; then primary changes no longer overwrite it. Sync applies only when **both** legs had a real `scheduled_at` at open (not “day-only” / Zeitabsprache rows).
- **Zeitabsprache (no pickup time)**: Leaving the **Uhrzeit** field empty matches create-trip **“Rückfahrt mit Zeitabsprache”**: `scheduled_at` is set to `null`, and an optional calendar day is stored on `requested_date` (yyyy-MM-dd) when a date is chosen — same pattern as unscheduled rows in [`trips-listing.tsx`](../src/features/trips/components/trips-listing.tsx) filters. The UI shows an empty time input (`--:--`). With neither date nor time, the trip is fully “open” (both fields null).
- **Submit**: [`rescheduleTripWithOptionalPair`](../src/features/trips/trip-reschedule/api/reschedule.actions.ts) sends `LegScheduleInput` per leg (`scheduled_at` + `requested_date` together, mirroring the DB).
- **Updates that affect 0 rows**: Reschedule uses `.select('id')` after `update` so a blocked RLS policy does not look like success. If you still see errors, align `trips` **UPDATE** and **SELECT** policies for your admin role in Supabase.

## Code map (English comments)

| Area | Location |
|------|----------|
| Feature folder (barrel import) | [`src/features/trips/trip-reschedule/`](../src/features/trips/trip-reschedule/) — see [`README.md`](../src/features/trips/trip-reschedule/README.md) |
| Eligibility + delta math | [`trip-reschedule/lib/reschedule-trip.ts`](../src/features/trips/trip-reschedule/lib/reschedule-trip.ts) |
| Supabase updates | [`trip-reschedule/api/reschedule.actions.ts`](../src/features/trips/trip-reschedule/api/reschedule.actions.ts) |
| UI | [`trip-reschedule/components/trip-reschedule-dialog.tsx`](../src/features/trips/trip-reschedule/components/trip-reschedule-dialog.tsx) |

UI: **`DatePicker`** + `<input type="time">` from `src/components/ui/date-time-picker.tsx` (same module as `DateTimePicker`) — split fields allow Zeitabsprache; see [`docs/date-picker.md`](date-picker.md).

Cancellation stays in [`recurring-exceptions.actions.ts`](../src/features/trips/api/recurring-exceptions.actions.ts); reschedule does not extend that file except by importing `findPairedTrip`.

---

## v2 checklist — recurring trips

**Not implemented in v1.** Moving a materialised recurring occurrence by only updating `trips.scheduled_at` can leave the **original** rule occurrence “empty”; the cron job [`src/app/api/cron/generate-recurring-trips/route.ts`](../src/app/api/cron/generate-recurring-trips/route.ts) may insert a **new** trip for that client at the old slot (duplicate check is by `client_id` + `scheduled_at`).

For v2, align with:

- Table `recurring_rule_exceptions`: `rule_id`, `exception_date`, `original_pickup_time`, `is_cancelled`, `modified_pickup_time`, etc.
- The cron matches exceptions by `exception_date` and `original_pickup_time` (from the rule’s pickup/return times).

Planned work for v2:

1. Define whether “reschedule” means moving within the same calendar day vs changing the recurrence instance date.
2. Insert or update the correct exception row(s) for **both** Hin- and Rückfahrt when the rule defines a return leg.
3. Update the existing `trips` row(s) `scheduled_at` to match.
4. Add tests or manual runbook for cron + exception interaction.

---

## Inline time in the detail sheet

The trip detail sheet still supports **same-day time** edits via the header time input and **Aktualisieren**; that path updates **one** trip only. Full date+time moves and paired moves use **Verschieben** and the dialog above.
