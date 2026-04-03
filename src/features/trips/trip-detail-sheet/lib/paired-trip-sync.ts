/**
 * Hin/Rück paired-leg policy for the trip detail sheet.
 *
 * Linked trips are two `trips` rows (`linked_trip_id`). Normal `updateTrip(id)` only
 * touches one row; this module defines which columns may be copied to the partner
 * leg when the user explicitly chooses “Diese Fahrt + Gegenfahrt”.
 *
 * Mirroring follows the same **endpoint swap** as new returns (`swapRouteEndpoints` in
 * `build-return-trip-insert.ts`): the partner’s pickup side reflects this leg’s
 * **dropoff** drafts (and vice versa), including addresses, structured fields, coords,
 * stations, and Stammdaten; driving metrics are recomputed when four coords exist.
 */

import type { Trip } from '@/features/trips/api/trips.service';
import type { AddressResult } from '@/features/trips/components/trip-address-passenger';
import { fetchDrivingMetrics } from '@/features/trips/lib/fetch-driving-metrics';

/**
 * Supabase column names that (1) make “Trip aktualisieren” offer the paired dialog
 * when present in the primary PATCH, and (2) are written on the partner row when the
 * user chooses “Diese Fahrt + Gegenfahrt”. Excludes schedule/driver — see doc section
 * “Verknüpfte Gegenfahrt” in `docs/trip-detail-sheet-editing.md`.
 */
export const PAIRED_SYNC_COLUMN_KEYS = [
  'client_id',
  'client_name',
  'client_phone',
  'is_wheelchair',
  'payer_id',
  'billing_variant_id',
  'notes',
  'pickup_address',
  'pickup_street',
  'pickup_street_number',
  'pickup_zip_code',
  'pickup_city',
  'pickup_lat',
  'pickup_lng',
  'pickup_station',
  'pickup_location',
  'dropoff_address',
  'dropoff_street',
  'dropoff_street_number',
  'dropoff_zip_code',
  'dropoff_city',
  'dropoff_lat',
  'dropoff_lng',
  'dropoff_station',
  'dropoff_location',
  /** Billing metadata: same values on both legs (no route swap). */
  'billing_calling_station',
  'billing_betreuer',
  'kts_document_applies',
  'kts_source',
  'driving_distance_km',
  'driving_duration_seconds'
] as const;

export type PairedSyncColumnKey = (typeof PAIRED_SYNC_COLUMN_KEYS)[number];

const PAIRED_KEY_SET = new Set<string>(PAIRED_SYNC_COLUMN_KEYS);

export function patchTouchesPairedRelevantFields(
  patch: Record<string, unknown>
): boolean {
  return Object.keys(patch).some((k) => PAIRED_KEY_SET.has(k));
}

/**
 * After building the primary PATCH for the open trip, decide whether to ask the user
 * about updating the linked Gegenfahrt. Offer when any mirrored column changes in
 * `patch`, or when notes differ (notes are edited in the textarea but may not appear
 * in the details PATCH until a paired save merges them).
 */
export function shouldOfferPairedSyncForDetailsSave(
  patch: Record<string, unknown>,
  notesDirty: boolean
): boolean {
  return patchTouchesPairedRelevantFields(patch) || notesDirty;
}

export function shouldOfferPairedSyncForNotesOnlySave(
  notesDirty: boolean,
  hasLinkedPartner: boolean
): boolean {
  return hasLinkedPartner && notesDirty;
}

/**
 * Form state used to build the partner PATCH: same drafts as the open trip plus
 * `trip` for fallbacks when structured fields/coords are unchanged from DB.
 */
export interface PartnerSyncDrafts {
  trip: Trip;
  clientIdDraft: string | null;
  clientNameComposed: string;
  clientPhoneDraft: string;
  wheelchairDraft: boolean;
  payerDraft: string;
  billingVariantDraft: string;
  notesDraft: string;
  pickupAddressDraft: string;
  dropoffAddressDraft: string;
  pickupStationDraft: string;
  dropoffStationDraft: string;
  billingCallingStationDraft: string;
  billingBetreuerDraft: string;
  ktsDocumentAppliesDraft: boolean;
  ktsSourceForSave: string;
  lastPickupResolved: AddressResult | null;
  lastDropoffResolved: AddressResult | null;
}

function stationTrimOrNull(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

interface EndpointSide {
  address: string;
  street: string | null;
  street_number: string | null;
  zip_code: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  location: unknown | null;
}

/** This leg’s pickup endpoint: draft string + resolver override `trip` where set. */
function pickupSideFromDrafts(
  trip: Trip,
  addressDraft: string,
  resolved: AddressResult | null
): EndpointSide {
  return {
    address: addressDraft || '',
    street: resolved?.street ?? trip.pickup_street ?? null,
    street_number: resolved?.street_number ?? trip.pickup_street_number ?? null,
    zip_code: resolved?.zip_code ?? trip.pickup_zip_code ?? null,
    city: resolved?.city ?? trip.pickup_city ?? null,
    lat:
      typeof resolved?.lat === 'number'
        ? resolved.lat
        : typeof trip.pickup_lat === 'number'
          ? trip.pickup_lat
          : null,
    lng:
      typeof resolved?.lng === 'number'
        ? resolved.lng
        : typeof trip.pickup_lng === 'number'
          ? trip.pickup_lng
          : null,
    location: trip.pickup_location ?? null
  };
}

/** This leg’s dropoff endpoint: draft string + resolver override `trip` where set. */
function dropoffSideFromDrafts(
  trip: Trip,
  addressDraft: string,
  resolved: AddressResult | null
): EndpointSide {
  return {
    address: addressDraft || '',
    street: resolved?.street ?? trip.dropoff_street ?? null,
    street_number:
      resolved?.street_number ?? trip.dropoff_street_number ?? null,
    zip_code: resolved?.zip_code ?? trip.dropoff_zip_code ?? null,
    city: resolved?.city ?? trip.dropoff_city ?? null,
    lat:
      typeof resolved?.lat === 'number'
        ? resolved.lat
        : typeof trip.dropoff_lat === 'number'
          ? trip.dropoff_lat
          : null,
    lng:
      typeof resolved?.lng === 'number'
        ? resolved.lng
        : typeof trip.dropoff_lng === 'number'
          ? trip.dropoff_lng
          : null,
    location: trip.dropoff_location ?? null
  };
}

/**
 * Maps two endpoint snapshots to a PATCH for the **partner** row: pickup fields from
 * `dr`, dropoff from `pu` (inverse of this leg’s semantics).
 */
function buildSwappedRoutePatchForPartner(
  pu: EndpointSide,
  dr: EndpointSide
): Record<string, unknown> {
  return {
    pickup_address: dr.address,
    pickup_street: dr.street,
    pickup_street_number: dr.street_number,
    pickup_zip_code: dr.zip_code,
    pickup_city: dr.city,
    pickup_lat: dr.lat,
    pickup_lng: dr.lng,
    pickup_location: dr.location,
    dropoff_address: pu.address,
    dropoff_street: pu.street,
    dropoff_street_number: pu.street_number,
    dropoff_zip_code: pu.zip_code,
    dropoff_city: pu.city,
    dropoff_lat: pu.lat,
    dropoff_lng: pu.lng,
    dropoff_location: pu.location
  };
}

/**
 * Full snapshot for the partner leg: swapped route from drafts + Stammdaten/Abrechnung
 * from the same form state as the open trip.
 */
export function buildPartnerSyncPatchFromDrafts(
  input: PartnerSyncDrafts
): Record<string, unknown> {
  const name = input.clientNameComposed.trim();
  const phone = input.clientPhoneDraft.trim();
  const notes = input.notesDraft.trim();
  const pu = pickupSideFromDrafts(
    input.trip,
    input.pickupAddressDraft,
    input.lastPickupResolved
  );
  const dr = dropoffSideFromDrafts(
    input.trip,
    input.dropoffAddressDraft,
    input.lastDropoffResolved
  );
  const route = buildSwappedRoutePatchForPartner(pu, dr);
  return {
    ...route,
    pickup_station: stationTrimOrNull(input.dropoffStationDraft),
    dropoff_station: stationTrimOrNull(input.pickupStationDraft),
    client_id: input.clientIdDraft,
    client_name: name ? name : null,
    client_phone: phone ? phone : null,
    is_wheelchair: input.wheelchairDraft,
    payer_id: input.payerDraft || null,
    billing_variant_id: input.billingVariantDraft || null,
    notes: notes ? notes : null,
    billing_calling_station: stationTrimOrNull(
      input.billingCallingStationDraft
    ),
    billing_betreuer: stationTrimOrNull(input.billingBetreuerDraft),
    kts_document_applies: input.ktsDocumentAppliesDraft,
    kts_source: input.ktsSourceForSave
  };
}

/**
 * After `buildPartnerSyncPatchFromDrafts`, fills `driving_distance_km` and
 * `driving_duration_seconds` on the partner patch when all four endpoint coords are
 * numbers (Google Directions). No-op if coords are missing or the API returns null.
 */
export async function finalizePartnerPatchWithDrivingMetrics(
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const plat = patch.pickup_lat;
  const plng = patch.pickup_lng;
  const dlat = patch.dropoff_lat;
  const dlng = patch.dropoff_lng;
  if (
    typeof plat === 'number' &&
    typeof plng === 'number' &&
    typeof dlat === 'number' &&
    typeof dlng === 'number'
  ) {
    const metrics = await fetchDrivingMetrics(plat, plng, dlat, dlng);
    if (metrics) {
      return {
        ...patch,
        driving_distance_km: metrics.distanceKm,
        driving_duration_seconds: metrics.durationSeconds
      };
    }
  }
  return patch;
}
