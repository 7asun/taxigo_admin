/**
 * build-trip-details-patch.test.ts
 *
 * Verifies the clear-time branch added in Step 3: when the user empties the time
 * field on a trip that has a non-null `scheduled_at`, the patch must set
 * `scheduled_at: null` and preserve `requested_date` on the correct calendar day.
 *
 * Tests exercise `buildTripDetailsPatch` in isolation (no Supabase, no Google).
 * Address fields are kept identical to the trip stub so `fetchDrivingMetrics`
 * is never invoked (no coordinate change → no metrics recomputation branch).
 */

import { describe, expect, test } from 'bun:test';

import { buildTripDetailsPatch } from '../build-trip-details-patch';
import { instantToYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import type { Trip } from '@/features/trips/api/trips.service';
import type { BuildTripDetailsPatchInput } from '../build-trip-details-patch';

// ─── Shared constants ─────────────────────────────────────────────────────────

// Trip scheduled at 08:00 Berlin on 2026-06-20 (UTC 06:00 in summer / UTC+2)
const TRIP_SCHEDULED_ISO = '2026-06-20T06:00:00.000Z';
const TRIP_SCHEDULED_YMD = '2026-06-20'; // business-day of TRIP_SCHEDULED_ISO
const TRIP_REQUESTED_DATE = '2026-06-20';

// A different date the user has selected in the date picker
const DATE_YMD_DRAFT = '2026-06-25';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tripStub(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 't1',
    company_id: 'co1',
    scheduled_at: TRIP_SCHEDULED_ISO,
    requested_date: TRIP_REQUESTED_DATE,
    payer_id: null,
    billing_variant_id: null,
    is_wheelchair: false,
    client_id: null,
    client_name: null,
    client_phone: null,
    pickup_address: '123 Pickup St',
    pickup_station: null,
    pickup_street: '123 Pickup',
    pickup_street_number: null,
    pickup_zip_code: null,
    pickup_city: null,
    pickup_lat: null,
    pickup_lng: null,
    dropoff_address: '456 Dropoff Ave',
    dropoff_station: null,
    dropoff_street: '456 Dropoff',
    dropoff_street_number: null,
    dropoff_zip_code: null,
    dropoff_city: null,
    dropoff_lat: null,
    dropoff_lng: null,
    billing_calling_station: null,
    billing_betreuer: null,
    kts_document_applies: false,
    kts_fehler: false,
    kts_fehler_beschreibung: null,
    kts_patient_id: null,
    kts_source: 'manual',
    no_invoice_required: false,
    no_invoice_source: 'manual',
    reha_schein: false,
    ...overrides
  } as unknown as Trip;
}

/**
 * Returns a `BuildTripDetailsPatchInput` where every draft value mirrors the
 * trip stub — produces an empty patch unless specific fields are overridden.
 */
function inputFor(
  trip: Trip,
  overrides: Partial<BuildTripDetailsPatchInput> = {}
): BuildTripDetailsPatchInput {
  const ymd = trip.scheduled_at
    ? instantToYmdInBusinessTz(new Date(trip.scheduled_at).getTime())
    : (trip.requested_date ?? '');

  return {
    trip,
    payerDraft: trip.payer_id ?? '',
    billingVariantDraft: trip.billing_variant_id ?? '',
    wheelchairDraft: !!trip.is_wheelchair,
    clientIdDraft: trip.client_id ?? null,
    clientFirstDraft: '',
    clientLastDraft: trip.client_name ?? '',
    clientPhoneDraft: trip.client_phone ?? '',
    pickupAddressDraft: trip.pickup_address ?? '',
    pickupStationDraft: trip.pickup_station ?? '',
    dropoffAddressDraft: trip.dropoff_address ?? '',
    dropoffStationDraft: trip.dropoff_station ?? '',
    dateYmdDraft: ymd,
    currentDateYmd: ymd,
    timeDraft: '', // default: no time set
    lastPickupResolved: null,
    lastDropoffResolved: null,
    billingCallingStationDraft: trip.billing_calling_station ?? '',
    billingBetreuerDraft: trip.billing_betreuer ?? '',
    ktsDocumentAppliesDraft: !!trip.kts_document_applies,
    ktsFehlerDraft: !!trip.kts_fehler,
    ktsFehlerBeschreibungDraft: trip.kts_fehler_beschreibung ?? '',
    ktsPatientIdDraft: trip.kts_patient_id ?? null,
    ktsSourceForSave: trip.kts_source ?? 'manual',
    noInvoiceRequiredDraft: !!trip.no_invoice_required,
    noInvoiceSourceForSave: trip.no_invoice_source ?? 'manual',
    rehaScheinForSave: false,
    ...overrides
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('buildTripDetailsPatch — clear-time branch', () => {
  test('1. Clear time: trip has scheduled_at, dateYmdDraft set → patch has scheduled_at: null and requested_date from dateYmdDraft', async () => {
    const trip = tripStub();
    const result = await buildTripDetailsPatch(
      inputFor(trip, {
        timeDraft: '',
        dateYmdDraft: DATE_YMD_DRAFT,
        currentDateYmd: TRIP_SCHEDULED_YMD
      })
    );

    expect(result.patch.scheduled_at).toBeNull();
    expect(result.patch.requested_date).toBe(DATE_YMD_DRAFT);
    expect(result.isEmpty).toBe(false);
  });

  test('2. Clear time, dateYmdDraft empty: falls back to trip.requested_date', async () => {
    const EXISTING_REQUESTED = '2026-06-22';
    const trip = tripStub({ requested_date: EXISTING_REQUESTED });

    const result = await buildTripDetailsPatch(
      inputFor(trip, {
        timeDraft: '',
        dateYmdDraft: '',
        currentDateYmd: TRIP_SCHEDULED_YMD
      })
    );

    expect(result.patch.scheduled_at).toBeNull();
    expect(result.patch.requested_date).toBe(EXISTING_REQUESTED);
  });

  test('3. Clear time, dateYmdDraft empty, trip.requested_date null: derives requested_date from old scheduled_at business day', async () => {
    const trip = tripStub({ requested_date: null });

    const result = await buildTripDetailsPatch(
      inputFor(trip, {
        timeDraft: '',
        dateYmdDraft: '',
        currentDateYmd: TRIP_SCHEDULED_YMD
      })
    );

    const expectedYmd = instantToYmdInBusinessTz(
      new Date(TRIP_SCHEDULED_ISO).getTime()
    );

    expect(result.patch.scheduled_at).toBeNull();
    expect(result.patch.requested_date).toBe(expectedYmd);
  });

  test('4. Trip already has no scheduled_at: clearing time is a no-op (scheduled_at not in patch)', async () => {
    const trip = tripStub({
      scheduled_at: null,
      requested_date: TRIP_REQUESTED_DATE
    });

    const result = await buildTripDetailsPatch(
      inputFor(trip, {
        timeDraft: '',
        dateYmdDraft: TRIP_REQUESTED_DATE,
        currentDateYmd: TRIP_REQUESTED_DATE
      })
    );

    expect('scheduled_at' in result.patch).toBe(false);
    expect(result.isEmpty).toBe(true);
  });

  test('5. Regression: setting a time (non-empty timeDraft) on same day still produces correct ISO scheduled_at', async () => {
    // The existing same-day time-change branch must be unaffected.
    // Trip at 08:00 Berlin; user sets 14:30 Berlin → UTC 12:30 in summer (UTC+2).
    const NEW_TIME_HM = '14:30';
    const EXPECTED_ISO = '2026-06-20T12:30:00.000Z';

    const trip = tripStub();

    const result = await buildTripDetailsPatch(
      inputFor(trip, {
        timeDraft: NEW_TIME_HM,
        dateYmdDraft: TRIP_SCHEDULED_YMD,
        currentDateYmd: TRIP_SCHEDULED_YMD
      })
    );

    expect(result.patch.scheduled_at).toBe(EXPECTED_ISO);
    expect('requested_date' in result.patch).toBe(false);
  });
});
