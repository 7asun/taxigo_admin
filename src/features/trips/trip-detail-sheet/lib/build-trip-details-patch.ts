/**
 * Builds the Supabase PATCH for the sheet footer **Trip aktualisieren** action: Kostenträger,
 * billing variant, billing metadata (Anrufstation/Betreuer), client fields,
 * route/stations, date, and driving metrics when
 * endpoints change.
 *
 * This is only the diff for the **open** row. If the user later confirms
 * “Diese Fahrt + Gegenfahrt”, the linked leg’s update is built in
 * `paired-trip-sync.ts` (`buildPartnerSyncPatchFromDrafts` + swapped endpoints).
 */

import type { Trip } from '@/features/trips/api/trips.service';
import type { AddressResult } from '@/features/trips/components/trip-address-passenger';
import {
  applyTimeToScheduledDate,
  buildScheduledAtFromYmdAndHm
} from '@/features/trips/trip-detail-sheet/lib/apply-time-to-scheduled';
import { fetchDrivingMetrics } from '@/features/trips/lib/fetch-driving-metrics';

export function clientDisplayNameFromParts(
  first: string,
  last: string
): string {
  return [first, last]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ');
}

export interface BuildTripDetailsPatchInput {
  trip: Trip;
  payerDraft: string;
  billingVariantDraft: string;
  wheelchairDraft: boolean;
  clientIdDraft: string | null;
  clientFirstDraft: string;
  clientLastDraft: string;
  clientPhoneDraft: string;
  pickupAddressDraft: string;
  pickupStationDraft: string;
  dropoffAddressDraft: string;
  dropoffStationDraft: string;
  dateYmdDraft: string;
  currentDateYmd: string;
  timeDraft: string;
  lastPickupResolved: AddressResult | null;
  lastDropoffResolved: AddressResult | null;
  /** `trips.billing_*` — not Fahrgast pickup/dropoff_station. */
  billingCallingStationDraft: string;
  billingBetreuerDraft: string;
}

export interface BuildTripDetailsPatchResult {
  patch: Record<string, unknown>;
  isEmpty: boolean;
}

function normalizeNotes(s: string): string {
  return s.trim();
}

/**
 * Computes the PATCH object and whether it is empty (no DB write needed).
 * May call Google Directions when pickup/dropoff coordinates support metrics.
 */
export async function buildTripDetailsPatch(
  input: BuildTripDetailsPatchInput
): Promise<BuildTripDetailsPatchResult> {
  const { trip } = input;
  /** `Update` type omits some address columns; Supabase still accepts them. */
  const patch: Record<string, unknown> = {};

  if (input.payerDraft !== (trip.payer_id ?? '')) {
    patch.payer_id = input.payerDraft || null;
  }
  if (input.billingVariantDraft !== (trip.billing_variant_id ?? '')) {
    patch.billing_variant_id = input.billingVariantDraft || null;
  }
  if (input.wheelchairDraft !== !!trip.is_wheelchair) {
    patch.is_wheelchair = input.wheelchairDraft;
  }
  const cidNext = input.clientIdDraft ?? null;
  const cidWas = trip.client_id ?? null;
  if (cidNext !== cidWas) {
    patch.client_id = cidNext;
  }
  const nameT = normalizeNotes(
    clientDisplayNameFromParts(input.clientFirstDraft, input.clientLastDraft)
  );
  const nameWas = normalizeNotes(trip.client_name ?? '');
  if (nameT !== nameWas) {
    patch.client_name = nameT ? nameT : null;
  }
  const phoneT = normalizeNotes(input.clientPhoneDraft);
  const phoneWas = normalizeNotes(trip.client_phone ?? '');
  if (phoneT !== phoneWas) {
    patch.client_phone = phoneT ? phoneT : null;
  }
  if (
    normalizeNotes(input.pickupAddressDraft) !==
    normalizeNotes(trip.pickup_address ?? '')
  ) {
    const r = input.lastPickupResolved;
    patch.pickup_address = input.pickupAddressDraft || '';
    patch.pickup_street = r?.street ?? trip.pickup_street;
    patch.pickup_street_number = r?.street_number ?? trip.pickup_street_number;
    patch.pickup_zip_code = r?.zip_code ?? trip.pickup_zip_code;
    patch.pickup_city = r?.city ?? trip.pickup_city;
    if (typeof r?.lat === 'number' && typeof r?.lng === 'number') {
      patch.pickup_lat = r.lat;
      patch.pickup_lng = r.lng;
    }
  }
  if (
    normalizeNotes(input.pickupStationDraft) !==
    normalizeNotes(trip.pickup_station ?? '')
  ) {
    patch.pickup_station = input.pickupStationDraft.trim()
      ? input.pickupStationDraft.trim()
      : null;
  }
  if (
    normalizeNotes(input.dropoffAddressDraft) !==
    normalizeNotes(trip.dropoff_address ?? '')
  ) {
    const r = input.lastDropoffResolved;
    patch.dropoff_address = input.dropoffAddressDraft || '';
    patch.dropoff_street = r?.street ?? trip.dropoff_street;
    patch.dropoff_street_number =
      r?.street_number ?? trip.dropoff_street_number;
    patch.dropoff_zip_code = r?.zip_code ?? trip.dropoff_zip_code;
    patch.dropoff_city = r?.city ?? trip.dropoff_city;
    if (typeof r?.lat === 'number' && typeof r?.lng === 'number') {
      patch.dropoff_lat = r.lat;
      patch.dropoff_lng = r.lng;
    }
  }
  if (
    normalizeNotes(input.dropoffStationDraft) !==
    normalizeNotes(trip.dropoff_station ?? '')
  ) {
    patch.dropoff_station = input.dropoffStationDraft.trim()
      ? input.dropoffStationDraft.trim()
      : null;
  }

  const billingCallingNext = normalizeNotes(input.billingCallingStationDraft);
  const billingCallingWas = normalizeNotes(trip.billing_calling_station ?? '');
  if (billingCallingNext !== billingCallingWas) {
    patch.billing_calling_station = billingCallingNext
      ? billingCallingNext
      : null;
  }
  const billingBetreuerNext = normalizeNotes(input.billingBetreuerDraft);
  const billingBetreuerWas = normalizeNotes(trip.billing_betreuer ?? '');
  if (billingBetreuerNext !== billingBetreuerWas) {
    patch.billing_betreuer = billingBetreuerNext ? billingBetreuerNext : null;
  }

  if (input.dateYmdDraft !== input.currentDateYmd) {
    if (trip.scheduled_at && input.dateYmdDraft && input.timeDraft) {
      const next = buildScheduledAtFromYmdAndHm(
        input.dateYmdDraft,
        input.timeDraft
      );
      patch.scheduled_at = next.toISOString();
    } else if (
      !trip.scheduled_at &&
      input.dateYmdDraft &&
      input.timeDraft?.trim()
    ) {
      const next = buildScheduledAtFromYmdAndHm(
        input.dateYmdDraft,
        input.timeDraft
      );
      patch.scheduled_at = next.toISOString();
      patch.requested_date = null;
    } else if (input.dateYmdDraft && !trip.scheduled_at) {
      patch.requested_date = input.dateYmdDraft;
    }
  }

  if (
    !trip.scheduled_at &&
    trip.requested_date &&
    input.dateYmdDraft &&
    input.timeDraft?.trim() &&
    input.dateYmdDraft === input.currentDateYmd &&
    !('scheduled_at' in patch)
  ) {
    const next = buildScheduledAtFromYmdAndHm(
      input.dateYmdDraft,
      input.timeDraft
    );
    patch.scheduled_at = next.toISOString();
    patch.requested_date = null;
  }

  if (
    trip.scheduled_at &&
    input.dateYmdDraft &&
    input.dateYmdDraft === input.currentDateYmd &&
    input.timeDraft?.trim() &&
    !('scheduled_at' in patch)
  ) {
    const next = applyTimeToScheduledDate(trip.scheduled_at, input.timeDraft);
    if (next.toISOString() !== new Date(trip.scheduled_at).toISOString()) {
      patch.scheduled_at = next.toISOString();
    }
  }

  const pickupLat =
    typeof patch.pickup_lat === 'number' ? patch.pickup_lat : trip.pickup_lat;
  const pickupLng =
    typeof patch.pickup_lng === 'number' ? patch.pickup_lng : trip.pickup_lng;
  const dropLat =
    typeof patch.dropoff_lat === 'number'
      ? patch.dropoff_lat
      : trip.dropoff_lat;
  const dropLng =
    typeof patch.dropoff_lng === 'number'
      ? patch.dropoff_lng
      : trip.dropoff_lng;
  if (
    typeof pickupLat === 'number' &&
    typeof pickupLng === 'number' &&
    typeof dropLat === 'number' &&
    typeof dropLng === 'number' &&
    (patch.pickup_lat !== undefined || patch.dropoff_lat !== undefined)
  ) {
    const metrics = await fetchDrivingMetrics(
      pickupLat,
      pickupLng,
      dropLat,
      dropLng
    );
    if (metrics) {
      patch.driving_distance_km = metrics.distanceKm;
      patch.driving_duration_seconds = metrics.durationSeconds;
    }
  }

  return {
    patch,
    isEmpty: Object.keys(patch).length === 0
  };
}
