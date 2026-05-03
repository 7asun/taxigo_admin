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
  buildScheduledAt,
  parseScheduledAt
} from '@/features/trips/lib/trip-time';
import { fetchDrivingMetrics } from '@/features/trips/lib/fetch-driving-metrics';

export function clientDisplayNameFromParts(
  first: string,
  last: string,
  company?: string
): string {
  const parts = [first, last].map((s) => s.trim()).filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return company?.trim() || '';
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
  ktsDocumentAppliesDraft: boolean;
  ktsFehlerDraft: boolean;
  ktsFehlerBeschreibungDraft: string;
  /** Persisted with `kts_document_applies` (catalog tier vs manual). */
  ktsSourceForSave: string;
  noInvoiceRequiredDraft: boolean;
  /** Persisted with `no_invoice_required`. */
  noInvoiceSourceForSave: string;
  /**
   * When true, skip Directions (`fetchDrivingMetrics`) and omit distance/duration on the patch.
   * Set when the trip already appears on an invoice line item — keeps `trips` aligned with billing snapshots.
   */
  isDistanceLocked?: boolean;
}

export interface BuildTripDetailsPatchResult {
  patch: Record<string, unknown>;
  isEmpty: boolean;
}

function normalizeNotes(s: string): string {
  return s.trim();
}

function normalizeKtsFehlerBeschreibungStored(
  s: string | null | undefined
): string | null {
  const t = normalizeNotes(s ?? '');
  return t ? t : null;
}

/**
 * Computes the PATCH object and whether it is empty (no DB write needed).
 * May call Google Directions when pickup/dropoff coordinates support metrics.
 */
export async function buildTripDetailsPatch(
  input: BuildTripDetailsPatchInput
): Promise<BuildTripDetailsPatchResult> {
  const { trip, isDistanceLocked = false } = input;
  /** `Update` type omits some address columns; Supabase still accepts them. */
  const patch: Record<string, unknown> = {};

  if (input.payerDraft !== (trip.payer_id ?? '')) {
    patch.payer_id = input.payerDraft || null;
  }
  if (input.billingVariantDraft !== (trip.billing_variant_id ?? '')) {
    patch.billing_variant_id = input.billingVariantDraft || null;
  }
  const ktsAppliesNext = !!input.ktsDocumentAppliesDraft;
  const ktsAppliesWas = !!trip.kts_document_applies;
  const ktsSourceWas = trip.kts_source ?? '';
  if (
    ktsAppliesNext !== ktsAppliesWas ||
    input.ktsSourceForSave !== ktsSourceWas
  ) {
    patch.kts_document_applies = ktsAppliesNext;
    patch.kts_source = input.ktsSourceForSave;
  }
  const noInvNext = !!input.noInvoiceRequiredDraft;
  const noInvWas = !!trip.no_invoice_required;
  const noInvSrcWas = trip.no_invoice_source ?? '';
  if (noInvNext !== noInvWas || input.noInvoiceSourceForSave !== noInvSrcWas) {
    patch.no_invoice_required = noInvNext;
    patch.no_invoice_source = input.noInvoiceSourceForSave;
  }
  const ktsFehlerNext = !!input.ktsFehlerDraft;
  const ktsFehlerWas = !!trip.kts_fehler;
  if (ktsFehlerNext !== ktsFehlerWas) {
    patch.kts_fehler = ktsFehlerNext;
  }
  const beschStored = normalizeKtsFehlerBeschreibungStored(
    trip.kts_fehler_beschreibung
  );
  const beschDraft = ktsFehlerNext
    ? normalizeKtsFehlerBeschreibungStored(input.ktsFehlerBeschreibungDraft)
    : null;
  if (!ktsFehlerNext) {
    if (beschStored !== null) {
      patch.kts_fehler_beschreibung = null;
    }
  } else if (beschDraft !== beschStored) {
    patch.kts_fehler_beschreibung = beschDraft;
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
      // WHY `buildScheduledAt`: same Berlin-wall contract as Neue Fahrt / cron — not browser-local Date.
      patch.scheduled_at = buildScheduledAt(
        input.dateYmdDraft,
        input.timeDraft
      );
    } else if (
      !trip.scheduled_at &&
      input.dateYmdDraft &&
      input.timeDraft?.trim()
    ) {
      patch.scheduled_at = buildScheduledAt(
        input.dateYmdDraft,
        input.timeDraft
      );
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
    patch.scheduled_at = buildScheduledAt(input.dateYmdDraft, input.timeDraft);
    patch.requested_date = null;
  }

  if (
    trip.scheduled_at &&
    input.dateYmdDraft &&
    input.dateYmdDraft === input.currentDateYmd &&
    input.timeDraft?.trim() &&
    !('scheduled_at' in patch)
  ) {
    const { ymd } = parseScheduledAt(trip.scheduled_at);
    const nextIso = buildScheduledAt(ymd, input.timeDraft);
    if (nextIso !== new Date(trip.scheduled_at).toISOString()) {
      patch.scheduled_at = nextIso;
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
  const wouldRecomputeDrivingMetrics =
    typeof pickupLat === 'number' &&
    typeof pickupLng === 'number' &&
    typeof dropLat === 'number' &&
    typeof dropLng === 'number' &&
    (patch.pickup_lat !== undefined || patch.dropoff_lat !== undefined);

  if (wouldRecomputeDrivingMetrics) {
    if (isDistanceLocked) {
      // WHY: Do not call fetchDrivingMetrics at all — avoids Directions quota and implies we discard
      // metrics we would not persist (same as skipping the network round-trip entirely).
      delete patch.driving_distance_km;
      delete patch.driving_duration_seconds;
      console.warn(
        `[distance-freeze] Trip ${trip.id} distance update suppressed — trip is linked to an invoice line item. Fields excluded: driving_distance_km, driving_duration_seconds.`
      );
    } else {
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
  }

  if (isDistanceLocked) {
    delete patch.driving_distance_km;
    delete patch.driving_duration_seconds;
  }

  return {
    patch,
    isEmpty: Object.keys(patch).length === 0
  };
}
