/**
 * Server-side helpers to duplicate one-off trips to another calendar day (Fahrten bulk + detail sheet).
 *
 * Duplicates are **not** tied to `recurring_rules` (`rule_id` is always cleared). Hin/Rück pairs
 * are expanded from the selection, inserted outbound-first, then linked like bulk/Rückfahrt flows.
 *
 * `explicitPerLegUnifiedTimes`: optional outbound/return ISOs per leg; validated to a single pair.
 * Schedule math lives in `duplicate-trip-schedule.ts` (no Supabase).
 *
 * @see docs/trips-duplicate.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { InsertTrip } from '@/features/trips/api/trips.service';
import type { Trip } from '@/features/trips/api/trips.service';
import {
  computePreserveScheduleForLeg,
  computeReturnScheduleForDuplicate,
  computeTimeOpenSchedule,
  type DuplicateTripsPayload
} from '@/features/trips/lib/duplicate-trip-schedule';
import { instantToYmdInBusinessTz } from '@/features/trips/lib/trip-business-date';
import { getTripDirection } from '@/features/trips/lib/trip-direction';
import { getStatusWhenDriverChanges } from '@/features/trips/lib/trip-status';
import type { Database } from '@/types/database.types';

export type {
  DuplicateScheduleMode,
  DuplicateTripsPayload
} from '@/features/trips/lib/duplicate-trip-schedule';

/** Mirrors the client `findPairedTrip` queries so expansion runs on the service-role client. */
export async function findPairedTripWithClient(
  supabase: SupabaseClient<Database>,
  trip: Trip
): Promise<Trip | null> {
  if (trip.linked_trip_id) {
    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .eq('id', trip.linked_trip_id)
      .maybeSingle();
    if (!error && data) return data as Trip;
  }

  const { data: inverseLinked, error: inverseError } = await supabase
    .from('trips')
    .select('*')
    .eq('linked_trip_id', trip.id)
    .maybeSingle();

  if (!inverseError && inverseLinked) {
    return inverseLinked as Trip;
  }

  if (!trip.rule_id || !trip.scheduled_at) {
    return null;
  }

  const scheduledDate = new Date(trip.scheduled_at);
  const dateStr = scheduledDate.toISOString().split('T')[0];

  const { data: sameDayTrips, error } = await supabase
    .from('trips')
    .select('*')
    .eq('rule_id', trip.rule_id)
    .neq('id', trip.id)
    .gte('scheduled_at', `${dateStr}T00:00:00`)
    .lt('scheduled_at', `${dateStr}T23:59:59`);

  if (error || !sameDayTrips || sameDayTrips.length === 0) {
    return null;
  }

  return sameDayTrips[0] as Trip;
}

/**
 * Loads selected trips; optionally merges each row’s paired leg (Hin/Rück) into the same batch.
 * When `includeLinkedLeg` is false, callers get exactly the requested ids — used for detail-sheet
 * “nur diese Fahrt” so the new row is not forced into a pair with the partner.
 */
export async function fetchTripsExpandedForDuplicate(
  supabase: SupabaseClient<Database>,
  tripIds: string[],
  companyId: string,
  includeLinkedLeg: boolean
): Promise<Trip[]> {
  const unique = [...new Set(tripIds.filter(Boolean))];
  if (unique.length === 0) return [];

  const { data: rows, error } = await supabase
    .from('trips')
    .select('*')
    .in('id', unique)
    .eq('company_id', companyId);

  if (error) throw new Error(error.message);
  const map = new Map((rows ?? []).map((r) => [r.id, r as Trip]));

  if (includeLinkedLeg) {
    for (const t of [...map.values()]) {
      const partner = await findPairedTripWithClient(supabase, t);
      if (partner && partner.company_id === companyId && !map.has(partner.id)) {
        map.set(partner.id, partner);
      }
    }
  }

  return [...map.values()];
}

/** Same ordering as inserts (`outbound` first, then `return`). Exported for duplicate dialog UI. */
export function pickOutboundAndReturn(
  a: Trip,
  b: Trip
): { outbound: Trip; ret: Trip } {
  const dirA = getTripDirection(a);
  const dirB = getTripDirection(b);
  if (dirA === 'rueckfahrt' && dirB !== 'rueckfahrt') {
    return { outbound: b, ret: a };
  }
  if (dirB === 'rueckfahrt' && dirA !== 'rueckfahrt') {
    return { outbound: a, ret: b };
  }

  const ta = a.scheduled_at
    ? new Date(a.scheduled_at).getTime()
    : Number.POSITIVE_INFINITY;
  const tb = b.scheduled_at
    ? new Date(b.scheduled_at).getTime()
    : Number.POSITIVE_INFINITY;
  if (ta !== tb) {
    return ta <= tb ? { outbound: a, ret: b } : { outbound: b, ret: a };
  }
  return a.id <= b.id ? { outbound: a, ret: b } : { outbound: b, ret: a };
}

/** In-memory partner lookup so the same pair is not duplicated twice when both legs are selected. */
export function findPartnerAmongTrips(
  trip: Trip,
  pool: Trip[]
): Trip | undefined {
  if (trip.linked_trip_id) {
    const linked = pool.find((x) => x.id === trip.linked_trip_id);
    if (linked) return linked;
  }
  const inverse = pool.find((x) => x.linked_trip_id === trip.id);
  if (inverse) return inverse;

  if (!trip.rule_id || !trip.scheduled_at) return undefined;
  const selfYmd = instantToYmdInBusinessTz(
    new Date(trip.scheduled_at).getTime()
  );
  return pool.find(
    (x) =>
      x.id !== trip.id &&
      x.rule_id === trip.rule_id &&
      !!x.scheduled_at &&
      instantToYmdInBusinessTz(new Date(x.scheduled_at).getTime()) === selfYmd
  );
}

/** Two selected rows that form one Hin/Rück pair (bulk selection). */
export function tryGetOutboundReturnPairFromTrips(
  trips: Trip[]
): { outbound: Trip; ret: Trip } | null {
  if (trips.length !== 2) return null;
  const [a, b] = trips;
  const partner = findPartnerAmongTrips(a, trips);
  if (!partner || partner.id !== b.id) return null;
  return pickOutboundAndReturn(a, b);
}

export type DuplicateUnit =
  | { kind: 'single'; trip: Trip }
  | { kind: 'pair'; outbound: Trip; ret: Trip };

/**
 * Groups expanded rows into standalone trips or Hin+Rück pairs (each pair duplicated once).
 */
export function partitionIntoDuplicateUnits(trips: Trip[]): DuplicateUnit[] {
  const used = new Set<string>();
  const units: DuplicateUnit[] = [];

  for (const t of trips) {
    if (used.has(t.id)) continue;
    const partner = findPartnerAmongTrips(t, trips);
    if (partner && partner.id !== t.id && !used.has(partner.id)) {
      used.add(t.id);
      used.add(partner.id);
      const { outbound, ret } = pickOutboundAndReturn(t, partner);
      units.push({ kind: 'pair', outbound, ret });
    } else {
      used.add(t.id);
      units.push({ kind: 'single', trip: t });
    }
  }

  return units;
}

function copyRouteAndPassengerFields(
  source: Trip
): Pick<
  InsertTrip,
  | 'pickup_address'
  | 'pickup_street'
  | 'pickup_street_number'
  | 'pickup_zip_code'
  | 'pickup_city'
  | 'pickup_lat'
  | 'pickup_lng'
  | 'pickup_station'
  | 'pickup_location'
  | 'dropoff_address'
  | 'dropoff_street'
  | 'dropoff_street_number'
  | 'dropoff_zip_code'
  | 'dropoff_city'
  | 'dropoff_lat'
  | 'dropoff_lng'
  | 'dropoff_station'
  | 'dropoff_location'
  | 'client_id'
  | 'client_name'
  | 'client_phone'
  | 'is_wheelchair'
  | 'greeting_style'
  | 'payer_id'
  | 'billing_variant_id'
  | 'billing_betreuer'
  | 'billing_calling_station'
  | 'kts_document_applies'
  | 'kts_source'
  | 'payment_method'
  | 'vehicle_id'
  | 'notes'
  | 'note'
  | 'price'
  | 'driving_distance_km'
  | 'driving_duration_seconds'
  | 'has_missing_geodata'
  | 'stop_order'
> {
  return {
    pickup_address: source.pickup_address,
    pickup_street: source.pickup_street,
    pickup_street_number: source.pickup_street_number,
    pickup_zip_code: source.pickup_zip_code,
    pickup_city: source.pickup_city,
    pickup_lat: source.pickup_lat,
    pickup_lng: source.pickup_lng,
    pickup_station: source.pickup_station,
    pickup_location: source.pickup_location,
    dropoff_address: source.dropoff_address,
    dropoff_street: source.dropoff_street,
    dropoff_street_number: source.dropoff_street_number,
    dropoff_zip_code: source.dropoff_zip_code,
    dropoff_city: source.dropoff_city,
    dropoff_lat: source.dropoff_lat,
    dropoff_lng: source.dropoff_lng,
    dropoff_station: source.dropoff_station,
    dropoff_location: source.dropoff_location,
    client_id: source.client_id,
    client_name: source.client_name,
    client_phone: source.client_phone,
    is_wheelchair: source.is_wheelchair,
    greeting_style: source.greeting_style,
    payer_id: source.payer_id,
    billing_variant_id: source.billing_variant_id,
    billing_betreuer: source.billing_betreuer,
    billing_calling_station: source.billing_calling_station,
    kts_document_applies: !!source.kts_document_applies,
    kts_source: 'manual',
    payment_method: source.payment_method,
    vehicle_id: source.vehicle_id,
    notes: source.notes,
    note: source.note,
    price: source.price,
    driving_distance_km: source.driving_distance_km,
    driving_duration_seconds: source.driving_duration_seconds,
    has_missing_geodata: source.has_missing_geodata,
    stop_order: source.stop_order
  };
}

function buildDuplicateInsert(
  source: Trip,
  schedule: { scheduled_at: string | null; requested_date: string | null },
  link: { link_type: string | null; linked_trip_id: string | null },
  createdBy: string | null
): InsertTrip {
  const status =
    (getStatusWhenDriverChanges('pending', null) as 'pending' | undefined) ??
    'pending';

  return {
    ...copyRouteAndPassengerFields(source),
    company_id: source.company_id,
    created_by: createdBy,
    driver_id: null,
    rule_id: null,
    group_id: null,
    scheduled_at: schedule.scheduled_at,
    requested_date: schedule.requested_date,
    link_type: link.link_type,
    linked_trip_id: link.linked_trip_id,
    status,
    stop_updates: [],
    needs_driver_assignment: false,
    ingestion_source: 'trip_duplicate',
    actual_pickup_at: null,
    actual_dropoff_at: null,
    canceled_reason_notes: null,
    return_status: null
  };
}

export interface DuplicateTripsResult {
  createdIds: string[];
}

/**
 * Inserts duplicate rows + outbound link backfill. `explicitPerLegUnifiedTimes` requires
 * `partitionIntoDuplicateUnits` to yield exactly one `{ kind: 'pair' }` unit.
 */
export async function executeDuplicateTrips(
  supabase: SupabaseClient<Database>,
  payload: DuplicateTripsPayload,
  companyId: string,
  createdBy: string | null
): Promise<DuplicateTripsResult> {
  // Omitted or true: match legacy bulk behaviour (expand partner). False: strict id list only.
  const includeLinkedLeg = payload.includeLinkedLeg !== false;
  const expanded = await fetchTripsExpandedForDuplicate(
    supabase,
    payload.ids,
    companyId,
    includeLinkedLeg
  );

  const requested = new Set(payload.ids);
  const loaded = new Set(expanded.map((t) => t.id));
  for (const id of requested) {
    if (!loaded.has(id)) {
      throw new Error(
        'Einige Fahrten existieren nicht oder gehören nicht zu Ihrem Unternehmen.'
      );
    }
  }

  const units = partitionIntoDuplicateUnits(expanded);
  const createdIds: string[] = [];

  // Detail dialog: two optional ISOs per leg; invalid for multi-unit bulk selections.
  if (payload.explicitPerLegUnifiedTimes) {
    if (units.length !== 1 || units[0].kind !== 'pair') {
      throw new Error(
        'Explizite Hin-/Rück-Uhrzeiten sind nur für ein einzelnes Hin-/Rück-Paar möglich.'
      );
    }
  }

  for (const unit of units) {
    if (unit.kind === 'single') {
      let schedule: {
        scheduled_at: string | null;
        requested_date: string | null;
      };
      if (payload.scheduleMode === 'time_open') {
        schedule = computeTimeOpenSchedule(payload.targetDateYmd);
      } else if (payload.scheduleMode === 'unified_time') {
        const iso = payload.unifiedScheduledAtIso;
        if (!iso) {
          throw new Error('Bitte eine Abholzeit festlegen.');
        }
        schedule = {
          scheduled_at: iso,
          requested_date: instantToYmdInBusinessTz(new Date(iso).getTime())
        };
      } else {
        schedule = computePreserveScheduleForLeg(
          unit.trip,
          payload.targetDateYmd
        );
      }

      const insert = buildDuplicateInsert(
        unit.trip,
        schedule,
        { link_type: null, linked_trip_id: null },
        createdBy
      );

      const { data: row, error } = await supabase
        .from('trips')
        .insert(insert)
        .select('id')
        .single();

      if (error) throw new Error(error.message);
      createdIds.push(row.id);
      continue;
    }

    // Pair: outbound first, then return, then stamp outbound link_type for findPairedTrip / Zeitabsprache.
    let outSchedule: {
      scheduled_at: string | null;
      requested_date: string | null;
    };
    if (payload.scheduleMode === 'time_open') {
      outSchedule = computeTimeOpenSchedule(payload.targetDateYmd);
    } else if (payload.scheduleMode === 'unified_time') {
      // Missing outbound ISO is allowed only when `explicitPerLegUnifiedTimes` (detail pair).
      const iso = payload.unifiedScheduledAtIso;
      if (iso) {
        outSchedule = {
          scheduled_at: iso,
          requested_date: instantToYmdInBusinessTz(new Date(iso).getTime())
        };
      } else {
        outSchedule = {
          scheduled_at: null,
          requested_date: payload.targetDateYmd
        };
      }
    } else {
      outSchedule = computePreserveScheduleForLeg(
        unit.outbound,
        payload.targetDateYmd
      );
    }

    const retSchedule =
      payload.scheduleMode === 'unified_time' &&
      payload.unifiedReturnScheduledAtIso
        ? (() => {
            const retIso = payload.unifiedReturnScheduledAtIso;
            const retMs = new Date(retIso).getTime();
            return {
              scheduled_at: retIso,
              requested_date: instantToYmdInBusinessTz(retMs)
            };
          })()
        : computeReturnScheduleForDuplicate(
            unit.outbound,
            unit.ret,
            outSchedule,
            payload.scheduleMode,
            payload.targetDateYmd,
            payload.unifiedScheduledAtIso
          );

    const outInsert = buildDuplicateInsert(
      unit.outbound,
      outSchedule,
      { link_type: null, linked_trip_id: null },
      createdBy
    );

    const { data: outRow, error: outErr } = await supabase
      .from('trips')
      .insert(outInsert)
      .select('id')
      .single();

    if (outErr) throw new Error(outErr.message);

    const retInsert = buildDuplicateInsert(
      unit.ret,
      retSchedule,
      { link_type: 'return', linked_trip_id: outRow.id },
      createdBy
    );

    const { data: retRow, error: retErr } = await supabase
      .from('trips')
      .insert(retInsert)
      .select('id')
      .single();

    if (retErr) throw new Error(retErr.message);

    const { error: linkErr } = await supabase
      .from('trips')
      .update({
        linked_trip_id: retRow.id,
        link_type: 'outbound'
      })
      .eq('id', outRow.id);

    if (linkErr) throw new Error(linkErr.message);

    // Order is part of the public contract: detail sheet navigates to ids[0] vs ids[1] by leg direction.
    createdIds.push(outRow.id, retRow.id);
  }

  return { createdIds };
}
