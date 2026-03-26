import type { Trip } from '@/features/trips/api/trips.service';
import { getTripDirection } from '@/features/trips/lib/trip-direction';

export interface CanCreateLinkedReturnResult {
  ok: boolean;
  /** Short German explanation when the action is disabled */
  reason?: string;
}

/** Normalises `behavior_profile.returnPolicy` (same rules as billing-type-behavior-dialog). */
function normalisedReturnPolicy(
  behaviorProfile: unknown
): 'none' | 'time_tbd' | 'exact' {
  if (!behaviorProfile || typeof behaviorProfile !== 'object') return 'none';
  const b = behaviorProfile as Record<string, unknown>;
  const raw = b.returnPolicy ?? b.return_policy ?? 'none';
  if (raw === 'create_placeholder') return 'time_tbd';
  if (raw === 'time_tbd') return 'time_tbd';
  if (raw === 'exact') return 'exact';
  return 'none';
}

/**
 * When false, the Abrechnungsart is configured for one-way trips only
 * (`returnPolicy === 'none'`) — hide the post-hoc “Rückfahrt” action so it
 * matches the create-trip flow.
 *
 * If billing join is missing (e.g. join failed), we still show the action
 * so dispatchers are not blocked.
 */
export function billingTypeAllowsPosthocLinkedReturn(
  billing:
    | { behavior_profile?: unknown }
    | { billing_types?: { behavior_profile?: unknown } | null }
    | null
    | undefined
): boolean {
  const bp =
    billing && typeof billing === 'object' && 'billing_types' in billing
      ? billing.billing_types?.behavior_profile
      : billing && typeof billing === 'object' && 'behavior_profile' in billing
        ? billing.behavior_profile
        : undefined;
  if (bp === undefined || bp === null) return true;
  return normalisedReturnPolicy(bp) !== 'none';
}

/**
 * Whether to render the “Rückfahrt” control in the trip detail sheet (hide
 * when not allowed, including billing-type one-way).
 */
export function shouldShowCreateReturnTripButton(
  trip: Pick<Trip, 'link_type' | 'linked_trip_id' | 'status'>,
  hasLinkedPartner: boolean,
  billing:
    | { behavior_profile?: unknown }
    | { billing_types?: { behavior_profile?: unknown } | null }
    | null
    | undefined
): boolean {
  if (!billingTypeAllowsPosthocLinkedReturn(billing)) return false;
  return canCreateLinkedReturn(trip, hasLinkedPartner).ok;
}

/**
 * Whether “Rückfahrt anlegen” is allowed from this trip row.
 *
 * Works the same for ad-hoc trips and for single occurrences generated from
 * recurring rules — we always operate on one concrete `trips` row.
 */
export function canCreateLinkedReturn(
  trip: Pick<Trip, 'link_type' | 'linked_trip_id' | 'status'>,
  hasLinkedPartner: boolean
): CanCreateLinkedReturnResult {
  if (hasLinkedPartner) {
    return {
      ok: false,
      reason: 'Für diese Fahrt existiert bereits eine verknüpfte Rückfahrt.'
    };
  }
  if (getTripDirection(trip) === 'rueckfahrt') {
    return {
      ok: false,
      reason: 'Rückfahrten können nur von der Hinfahrt aus angelegt werden.'
    };
  }
  if (trip.status === 'cancelled') {
    return {
      ok: false,
      reason:
        'Stornierte Fahrten können nicht als Ausgang für eine Rückfahrt dienen.'
    };
  }
  return { ok: true };
}
