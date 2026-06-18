/**
 * Shared schedule helpers for recurring trip materialisation and resync.
 *
 * Extracted from `recurring-trip-generator.ts` so that:
 *   1. `resyncFutureRecurringTrips` can reuse the same clock-normalisation and
 *      Berlin-instant logic without duplicating code.
 *   2. Tests can assert the schedule math directly without importing the generator
 *      (which pulls in heavy server-only dependencies like geocoding).
 *
 * Server-safe — no client hooks, no browser APIs.
 */

import { buildScheduledAt } from '@/features/trips/lib/trip-time';
import { RECURRING_RETURN_TBD_EXCEPTION_PICKUP_TIME } from '@/features/trips/lib/recurring-return-mode';

// ─── Clock normalisation ─────────────────────────────────────────────────────

/**
 * Normalises a DB-stored or form-submitted clock string to HH:MM:SS.
 *
 * WHY accept both HH:MM and HH:MM:SS: recurring_rules stores HH:MM:SS (form
 * appends ":00"), but callers that compare against raw DB values or pass through
 * RRule/exception keys must work in the same format.
 */
export function clockToHhMmSs(clock: string): string {
  const s = clock.trim();
  if (s.length >= 8 && s[2] === ':') {
    return s.slice(0, 8);
  }
  if (s.length === 5) {
    return `${s}:00`;
  }
  return s;
}

/**
 * Converts a Berlin calendar date + wall-clock to a UTC ISO timestamp for
 * `trips.scheduled_at`.
 *
 * Thin wrapper over `buildScheduledAt` so callers don't need to import both
 * `trip-time` and this module — one import covers generation + resync.
 */
export function scheduledIsoFromBerlinCalendarAndClock(
  dateStr: string,
  timeHhMmSs: string
): string {
  const t = clockToHhMmSs(timeHhMmSs);
  return buildScheduledAt(dateStr, t);
}

// ─── Exception key derivation ─────────────────────────────────────────────────

/**
 * Returns the `recurring_rule_exceptions.original_pickup_time` key that was
 * stamped on the exception row when the trip was materialised.
 *
 * CRITICAL: this function MUST receive `priorRule` (the pre-update rule state),
 * NOT the new schedule/payload. The key was written using the rule's time at the
 * moment of materialisation. Passing the new schedule would invert the lookup and
 * silently overwrite exception-protected trips instead of skipping them.
 *
 * Returns null when no time-keyed exception is possible for this leg (e.g. a
 * timeless outbound with pickup_time = null). Callers should skip exception
 * matching when the key is null.
 */
export function exceptionOriginalPickupTimeKey(
  trip: { link_type: string | null },
  priorRule: {
    pickup_time: string | null;
    return_time: string | null;
    return_mode: string;
  }
): string | null {
  if (trip.link_type === 'return') {
    const rm = priorRule.return_mode;
    if (rm === 'time_tbd') {
      // Zeitabsprache-Rückfahrt legs use the sentinel key (see recurring-return-mode.ts)
      return RECURRING_RETURN_TBD_EXCEPTION_PICKUP_TIME;
    }
    if (rm === 'exact' && priorRule.return_time) {
      return clockToHhMmSs(priorRule.return_time);
    }
    // return_mode 'none' or no return_time for 'exact' — no valid key
    return null;
  }

  // Outbound leg (link_type 'outbound' or null)
  if (priorRule.pickup_time) {
    return clockToHhMmSs(priorRule.pickup_time);
  }
  // Timeless outbound (pickup_time = null) — no time-keyed exception possible
  return null;
}

// ─── Resync time computation ──────────────────────────────────────────────────

/**
 * Recomputes `scheduled_at` for a single existing trip using the *new* schedule.
 *
 * Returns null when:
 *   - The leg has no applicable new time (timeless outbound, time_tbd / none return).
 *   - `requested_date` is null (data invariant violation — caller should skip).
 */
export function computeResyncScheduledAt(
  trip: { requested_date: string | null; link_type: string | null },
  newSchedule: {
    pickup_time: string | null;
    return_time: string | null;
    return_mode: string;
  }
): string | null {
  const { requested_date, link_type } = trip;
  if (!requested_date) return null;

  if (link_type === 'return') {
    // Only 'exact' return mode carries a fixed clock time
    if (newSchedule.return_mode === 'exact' && newSchedule.return_time) {
      return scheduledIsoFromBerlinCalendarAndClock(
        requested_date,
        newSchedule.return_time
      );
    }
    // 'time_tbd' and 'none' → scheduled_at = null
    return null;
  }

  // Outbound leg (link_type 'outbound' or null)
  if (newSchedule.pickup_time) {
    return scheduledIsoFromBerlinCalendarAndClock(
      requested_date,
      newSchedule.pickup_time
    );
  }
  // Timeless outbound → scheduled_at = null
  return null;
}
