import type { Trip } from '@/features/trips/api/trips.service';
import type { TripStatus } from '@/lib/trip-status';

/**
 * v1 reschedule scope: only non-recurring trips. Recurring trips (`rule_id`) require
 * `recurring_rule_exceptions` coordination so the cron job in
 * `app/api/cron/generate-recurring-trips/route.ts` does not recreate the old slot.
 * See docs/trip-reschedule-v1.md (v2 checklist).
 */
export function isRecurringTrip(trip: Pick<Trip, 'rule_id'>): boolean {
  return !!trip.rule_id;
}

const TERMINAL: TripStatus[] = ['completed', 'cancelled'];

/**
 * Whether the trip can be rescheduled in v1 (single / non-recurring flows).
 * v2 will extend this when recurring support is implemented.
 */
function hasScheduleOrRequestedDay(
  trip: Pick<Trip, 'scheduled_at' | 'requested_date'>
): boolean {
  const hasScheduled = !!trip.scheduled_at && trip.scheduled_at.trim() !== '';
  const hasRequested =
    !!trip.requested_date && trip.requested_date.trim() !== '';
  return hasScheduled || hasRequested;
}

export function canRescheduleTrip(
  trip: Pick<Trip, 'rule_id' | 'status' | 'scheduled_at' | 'requested_date'>
): boolean {
  if (isRecurringTrip(trip)) {
    return false;
  }
  if (!hasScheduleOrRequestedDay(trip)) {
    return false;
  }
  if (TERMINAL.includes(trip.status as TripStatus)) {
    return false;
  }
  return true;
}

/** German copy for `title` on disabled controls (Fahrten UI). */
export function getRescheduleDisabledReason(
  trip: Pick<Trip, 'rule_id' | 'status' | 'scheduled_at' | 'requested_date'>
): string | undefined {
  if (canRescheduleTrip(trip)) {
    return undefined;
  }
  if (isRecurringTrip(trip)) {
    return 'Wiederkehrende Fahrten können hier noch nicht verschoben werden.';
  }
  if (!hasScheduleOrRequestedDay(trip)) {
    return 'Kein Termin (weder Zeit noch Tag) — Verschieben nicht möglich.';
  }
  if (TERMINAL.includes(trip.status as TripStatus)) {
    return 'Abgeschlossene oder stornierte Fahrten können nicht verschoben werden.';
  }
  return 'Diese Fahrt kann nicht verschoben werden.';
}

export interface PairedRescheduleComputed {
  /** ISO string for the primary leg (same as input, normalized). */
  primaryIso: string;
  /** ISO for the paired leg, or null if there is no partner or partner has no `scheduled_at`. */
  partnerIso: string | null;
}

/**
 * Default paired behaviour: apply the same millisecond delta to the partner leg
 * so the gap between Hin- and Rückfahrt stays identical.
 */
export function computePairedReschedule(
  primary: Pick<Trip, 'scheduled_at'>,
  paired: Pick<Trip, 'scheduled_at'> | null,
  newPrimaryScheduledAt: Date
): PairedRescheduleComputed {
  const oldPrimaryAt = primary.scheduled_at;
  if (!oldPrimaryAt) {
    throw new Error('Primary trip must have scheduled_at for reschedule.');
  }

  const oldPrimaryMs = new Date(oldPrimaryAt).getTime();
  const newPrimaryMs = newPrimaryScheduledAt.getTime();
  const deltaMs = newPrimaryMs - oldPrimaryMs;

  const primaryIso = newPrimaryScheduledAt.toISOString();

  if (!paired?.scheduled_at) {
    return { primaryIso, partnerIso: null };
  }

  const partnerMs = new Date(paired.scheduled_at).getTime();
  const partnerIso = new Date(partnerMs + deltaMs).toISOString();

  return { primaryIso, partnerIso };
}
