/**
 * Server-only recurring trip materialisation — shared by Vercel cron and on-demand
 * server actions. Never import from client components.
 */

import { RRule, rrulestr } from 'rrule';
import {
  addDays,
  startOfDay,
  endOfDay,
  format,
  isAfter,
  isBefore
} from 'date-fns';
import { tz } from '@date-fns/tz';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import {
  getTripsBusinessTimeZone,
  getZonedDayBoundsIso,
  instantToYmdInBusinessTz
} from '@/features/trips/lib/trip-business-date';
import {
  clockToHhMmSs,
  scheduledIsoFromBerlinCalendarAndClock
} from '@/features/trips/lib/recurring-trip-schedule';
import {
  geocodeAddressLineToStructured,
  type GeocodedAddressLineResult
} from '@/lib/google-geocoding';
import {
  resolveDrivingMetricsWithCache,
  COORD_PRECISION,
  type DrivingMetrics
} from '@/lib/google-directions';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  RECURRING_RETURN_TBD_EXCEPTION_PICKUP_TIME,
  recurringReturnModeFromRow,
  type RecurringRuleReturnMode
} from '@/features/trips/lib/recurring-return-mode';
import {
  loadPricingContext,
  computeTripPrice,
  type PricingContext
} from '@/features/trips/lib/trip-price-engine';
import { normalizeKtsInsert } from '@/features/kts/kts.service';

/** Berlin forward window for cron and on-demand generation — single source of truth. */
export const RECURRING_TRIP_GENERATION_HORIZON_DAYS = 14;

type TripInsert = Database['public']['Tables']['trips']['Insert'];
type RecurringRuleRow = Database['public']['Tables']['recurring_rules']['Row'];

export type GenerateRecurringTripsResult = {
  generated: number;
  skipped: number;
  errors: number;
};

/**
 * Derives the route/passenger station codes for a generated trip from its rule.
 *
 * Outbound trips copy the rule stations directly.
 * Return trips swap them — the return passenger's pickup is the outbound dropoff station.
 *
 * These are NOT billing_calling_station / billing_betreuer (billing metadata).
 * Exported for focused unit tests — the logic is pure and has no side effects.
 */
export function deriveStationsForTrip(
  rule: { pickup_station: string | null; dropoff_station: string | null },
  isReturnTrip: boolean
): { pickup_station: string | null; dropoff_station: string | null } {
  return {
    pickup_station: isReturnTrip
      ? (rule.dropoff_station ?? null)
      : (rule.pickup_station ?? null),
    dropoff_station: isReturnTrip
      ? (rule.pickup_station ?? null)
      : (rule.dropoff_station ?? null)
  };
}

export async function generateRecurringTrips(options?: {
  ruleId?: string;
  supabase?: SupabaseClient<Database>;
}): Promise<GenerateRecurringTripsResult> {
  const supabase = options?.supabase ?? createAdminClient();

  const inTz = tz(getTripsBusinessTimeZone());
  const todayLocal = startOfDay(inTz(Date.now()), { in: inTz });
  const windowEndLocal = endOfDay(
    addDays(todayLocal, RECURRING_TRIP_GENERATION_HORIZON_DAYS, { in: inTz }),
    { in: inTz }
  );

  // WHY filter ruleId on the initial query (not after RRule): on-demand path must not
  // geocode or price unrelated rules when admin just created one Regelfahrt.
  let rulesQuery = supabase
    .from('recurring_rules')
    .select('*, billing_variants(billing_type_id)')
    .eq('is_active', true);

  if (options?.ruleId) {
    rulesQuery = rulesQuery.eq('id', options.ruleId);
  }

  const { data: rulesRaw, error: rulesError } = await rulesQuery;

  const rules = rulesRaw as
    | (RecurringRuleRow & {
        billing_variants: { billing_type_id: string } | null;
      })[]
    | null;

  if (rulesError) throw rulesError;
  if (!rules || rules.length === 0) {
    return { generated: 0, skipped: 0, errors: 0 };
  }

  const { data: exceptions, error: exceptionsError } = await supabase
    .from('recurring_rule_exceptions')
    .select('*')
    .in(
      'rule_id',
      rules.map((r) => r.id)
    )
    .gte('exception_date', format(todayLocal, 'yyyy-MM-dd', { in: inTz }))
    .lte('exception_date', format(windowEndLocal, 'yyyy-MM-dd', { in: inTz }));

  if (exceptionsError) throw exceptionsError;

  const geoCache = new Map<string, GeocodedAddressLineResult | null>();
  const drivingMetricsCache = new Map<string, DrivingMetrics | null>();

  async function resolveGeoLine(
    line: string
  ): Promise<GeocodedAddressLineResult | null> {
    const key = line.trim();
    if (!key) return null;
    if (geoCache.has(key)) return geoCache.get(key)!;
    const resolved = await geocodeAddressLineToStructured(key);
    geoCache.set(key, resolved);
    return resolved;
  }

  function mergeLegCoords(
    live: GeocodedAddressLineResult | null,
    lat: number,
    lng: number
  ): GeocodedAddressLineResult {
    if (live) {
      return { ...live, lat, lng };
    }
    return {
      lat,
      lng,
      street: null,
      street_number: null,
      zip_code: null,
      city: null,
      formatted_address: null
    };
  }

  let tripsInserted = 0;
  let tripsSkipped = 0;
  let errorCount = 0;

  async function buildTripPayload(params: {
    rule: RecurringRuleRow;
    client: Database['public']['Tables']['clients']['Row'];
    clientName: string;
    dateStr: string;
    isReturnTrip: boolean;
    returnMode: RecurringRuleReturnMode;
    exceptionTimeKey: string | null;
    scheduledAtIso: string | null;
    linkedTripId: string | null;
    outboundLinkType: 'outbound' | null;
    billing_type_id: string | null;
  }): Promise<TripInsert | null> {
    const {
      rule,
      client,
      clientName,
      dateStr,
      isReturnTrip,
      returnMode,
      exceptionTimeKey,
      scheduledAtIso,
      linkedTripId,
      outboundLinkType,
      billing_type_id
    } = params;

    const exception = exceptions?.find(
      (e) =>
        e.rule_id === rule.id &&
        e.exception_date === dateStr &&
        e.original_pickup_time === exceptionTimeKey
    );

    if (exception?.is_cancelled) {
      return null;
    }

    if (!isReturnTrip) {
      const pt = exception?.modified_pickup_time || rule.pickup_time;
      if (!pt && scheduledAtIso !== null) return null;
    } else if (returnMode === 'exact') {
      const pt = exception?.modified_pickup_time || rule.return_time;
      if (!pt) return null;
    }

    const pickupAddress =
      exception?.modified_pickup_address ||
      (isReturnTrip ? rule.dropoff_address : rule.pickup_address);
    const dropoffAddress =
      exception?.modified_dropoff_address ||
      (isReturnTrip ? rule.pickup_address : rule.dropoff_address);

    const hasAddressException =
      !!exception?.modified_pickup_address ||
      !!exception?.modified_dropoff_address;

    const pickupLive = await resolveGeoLine(pickupAddress);
    const dropoffLive = await resolveGeoLine(dropoffAddress);

    let pickupGeo: GeocodedAddressLineResult | null = pickupLive
      ? { ...pickupLive }
      : null;
    let dropoffGeo: GeocodedAddressLineResult | null = dropoffLive
      ? { ...dropoffLive }
      : null;

    const hasFullRuleCoords =
      rule.pickup_lat != null &&
      rule.pickup_lng != null &&
      rule.dropoff_lat != null &&
      rule.dropoff_lng != null;

    if (!hasAddressException && hasFullRuleCoords) {
      const pLat = rule.pickup_lat!;
      const pLng = rule.pickup_lng!;
      const dLat = rule.dropoff_lat!;
      const dLng = rule.dropoff_lng!;
      if (!isReturnTrip) {
        pickupGeo = mergeLegCoords(pickupGeo, pLat, pLng);
        dropoffGeo = mergeLegCoords(dropoffGeo, dLat, dLng);
      } else {
        pickupGeo = mergeLegCoords(pickupGeo, dLat, dLng);
        dropoffGeo = mergeLegCoords(dropoffGeo, pLat, pLng);
      }
    }

    const geodataOk = !!pickupGeo && !!dropoffGeo;

    let driving_distance_km: number | null = null;
    let driving_duration_seconds: number | null = null;
    if (pickupGeo && dropoffGeo) {
      const rPickupLat = parseFloat(pickupGeo.lat.toFixed(COORD_PRECISION));
      const rPickupLng = parseFloat(pickupGeo.lng.toFixed(COORD_PRECISION));
      const rDropoffLat = parseFloat(dropoffGeo.lat.toFixed(COORD_PRECISION));
      const rDropoffLng = parseFloat(dropoffGeo.lng.toFixed(COORD_PRECISION));
      const metricsKey = `${rPickupLat},${rPickupLng}|${rDropoffLat},${rDropoffLng}`;
      if (!drivingMetricsCache.has(metricsKey)) {
        drivingMetricsCache.set(
          metricsKey,
          await resolveDrivingMetricsWithCache(
            pickupGeo.lat,
            pickupGeo.lng,
            dropoffGeo.lat,
            dropoffGeo.lng,
            supabase,
            client.company_id
          )
        );
      }
      const legMetrics = drivingMetricsCache.get(metricsKey);
      if (legMetrics) {
        driving_distance_km = legMetrics.distanceKm;
        driving_duration_seconds = legMetrics.durationSeconds;
      }
    }

    const link_type = isReturnTrip ? 'return' : outboundLinkType;
    const hasFremdfirma = !!rule.fremdfirma_id;

    const payload: TripInsert = {
      company_id: client.company_id,
      client_id: client.id,
      client_name: clientName || '',
      client_phone: client.phone || '',
      payer_id: rule.payer_id,
      billing_variant_id: rule.billing_variant_id,
      kts_document_applies: rule.kts_document_applies ?? false,
      reha_schein: rule.reha_schein ?? false,
      kts_source: rule.kts_source ?? null,
      no_invoice_required: rule.no_invoice_required ?? false,
      no_invoice_source: rule.no_invoice_source ?? null,
      fremdfirma_id: rule.fremdfirma_id ?? null,
      fremdfirma_payment_mode: rule.fremdfirma_payment_mode ?? null,
      fremdfirma_cost: rule.fremdfirma_cost ?? null,
      ...(hasFremdfirma
        ? {
            driver_id: null,
            needs_driver_assignment: false,
            status: 'assigned' as const
          }
        : { status: 'pending' as const }),
      greeting_style: client.greeting_style,
      is_wheelchair: client.is_wheelchair,
      requested_date: dateStr,
      pickup_address: pickupAddress,
      pickup_street: pickupGeo?.street ?? null,
      pickup_street_number: pickupGeo?.street_number ?? null,
      pickup_zip_code: pickupGeo?.zip_code ?? null,
      pickup_city: pickupGeo?.city ?? null,
      pickup_lat: pickupGeo?.lat ?? null,
      pickup_lng: pickupGeo?.lng ?? null,
      ...deriveStationsForTrip(rule, isReturnTrip),
      dropoff_address: dropoffAddress,
      dropoff_street: dropoffGeo?.street ?? null,
      dropoff_street_number: dropoffGeo?.street_number ?? null,
      dropoff_zip_code: dropoffGeo?.zip_code ?? null,
      dropoff_city: dropoffGeo?.city ?? null,
      dropoff_lat: dropoffGeo?.lat ?? null,
      dropoff_lng: dropoffGeo?.lng ?? null,
      driving_distance_km,
      driving_duration_seconds,
      has_missing_geodata: !geodataOk,
      scheduled_at: scheduledAtIso,
      rule_id: rule.id,
      ingestion_source: 'recurring_rule',
      link_type,
      linked_trip_id: linkedTripId,
      billing_type_id,
      gross_price: null,
      tax_rate: null
    };

    return {
      ...payload,
      ...normalizeKtsInsert({
        kts_document_applies: payload.kts_document_applies,
        kts_source: payload.kts_source ?? null
      })
    };
  }

  async function findExistingRecurringLegId(q: {
    client_id: string;
    rule_id: string;
    requested_date: string;
    leg: 'outbound' | 'return';
  }): Promise<string | null> {
    let query = supabase
      .from('trips')
      .select('id')
      .eq('client_id', q.client_id)
      .eq('rule_id', q.rule_id)
      .eq('requested_date', q.requested_date);

    if (q.leg === 'outbound') {
      query = query.or('link_type.is.null,link_type.eq.outbound');
    } else {
      query = query.eq('link_type', 'return');
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return data.id;
  }

  async function insertIfAbsent(
    row: TripInsert,
    dedupKey: {
      client_id: string;
      rule_id: string;
      requested_date: string;
      leg: 'outbound' | 'return';
    }
  ): Promise<string | null> {
    const existing = await findExistingRecurringLegId(dedupKey);
    if (existing) {
      tripsSkipped++;
      return existing;
    }

    const { data, error } = await supabase
      .from('trips')
      .insert(row)
      .select('id')
      .single();

    if (error) {
      errorCount++;
      console.error('[generate-recurring-trips] insert failed:', error);
      return null;
    }
    tripsInserted++;
    return data.id;
  }

  const cronContextMap = new Map<string, PricingContext>();
  const emptyCtx: PricingContext = {
    rules: [],
    clientPriceTags: [],
    clientPriceTag: null
  };

  for (const rule of rules) {
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', rule.client_id)
      .single();

    if (clientError || !client) continue;

    if (!rule.payer_id) {
      console.warn(
        `[generate-recurring-trips] Skipping rule ${rule.id}: missing payer_id (edit and save the rule in Admin).`
      );
      continue;
    }

    let pricingCtx: PricingContext = emptyCtx;
    if (client.company_id) {
      const ctxKey = `${client.company_id}:${rule.payer_id}:${client.id}`;
      if (cronContextMap.has(ctxKey)) {
        pricingCtx = cronContextMap.get(ctxKey)!;
      } else {
        try {
          pricingCtx = await loadPricingContext({
            supabase,
            companyId: client.company_id,
            payerId: rule.payer_id,
            clientId: client.id
          });
          cronContextMap.set(ctxKey, pricingCtx);
        } catch (e) {
          console.error(
            '[trip-price-engine] loadPricingContext failed',
            ctxKey,
            e
          );
        }
      }
    }

    const clientName =
      (client.is_company
        ? client.company_name
        : `${client.first_name || ''} ${client.last_name || ''}`.trim()) || '';

    const ruleStartDateLocal = startOfDay(inTz(rule.start_date), {
      in: inTz
    });
    const ruleEndDateLocal = rule.end_date
      ? endOfDay(inTz(rule.end_date), { in: inTz })
      : windowEndLocal;

    const businessTz = getTripsBusinessTimeZone();
    const dtStartStr = `${rule.start_date.replace(/-/g, '')}T000000`;

    let rruleObj: RRule;
    try {
      const rruleStr = `DTSTART;TZID=${businessTz}:${dtStartStr}\n${rule.rrule_string}`;
      rruleObj = rrulestr(rruleStr) as RRule;
    } catch (e) {
      console.error('Invalid RRule', rule.rrule_string, e);
      continue;
    }

    const searchStartLocal = isAfter(todayLocal, ruleStartDateLocal)
      ? todayLocal
      : ruleStartDateLocal;
    const searchEndLocal = isBefore(windowEndLocal, ruleEndDateLocal)
      ? windowEndLocal
      : ruleEndDateLocal;

    if (isAfter(searchStartLocal, searchEndLocal)) continue;

    const ymdSearchStart = format(searchStartLocal, 'yyyy-MM-dd', {
      in: inTz
    });
    const ymdSearchEnd = format(searchEndLocal, 'yyyy-MM-dd', { in: inTz });
    const rangeStartUtc = getZonedDayBoundsIso(ymdSearchStart).startISO;
    const rangeEndExclusiveUtc =
      getZonedDayBoundsIso(ymdSearchEnd).endExclusiveISO;
    const rangeEndInclusive = new Date(
      new Date(rangeEndExclusiveUtc).getTime() - 1
    );

    const occurrencesUTC = rruleObj.between(
      new Date(rangeStartUtc),
      rangeEndInclusive,
      true
    );

    const returnMode = recurringReturnModeFromRow(rule);

    for (const dateUTC of occurrencesUTC) {
      const dateStr = instantToYmdInBusinessTz(dateUTC.getTime());

      const isOutboundTimeless = !rule.pickup_time;

      const outboundExceptionKey = isOutboundTimeless
        ? null
        : clockToHhMmSs(rule.pickup_time!);

      const outboundScheduledIso = isOutboundTimeless
        ? null
        : scheduledIsoFromBerlinCalendarAndClock(
            dateStr,
            exceptions?.find(
              (e) =>
                e.rule_id === rule.id &&
                e.exception_date === dateStr &&
                e.original_pickup_time === outboundExceptionKey
            )?.modified_pickup_time || rule.pickup_time!
          );

      const outboundPayload = await buildTripPayload({
        rule,
        client,
        clientName,
        dateStr,
        isReturnTrip: false,
        returnMode,
        exceptionTimeKey: outboundExceptionKey,
        scheduledAtIso: outboundScheduledIso,
        linkedTripId: null,
        outboundLinkType: null,
        billing_type_id: rule.billing_variants?.billing_type_id || null
      });

      if (!outboundPayload) continue;

      const outboundWithPrice: TripInsert = {
        ...outboundPayload,
        ...computeTripPrice(
          {
            payer_id: outboundPayload.payer_id ?? null,
            billing_type_id: outboundPayload.billing_type_id ?? null,
            billing_variant_id: outboundPayload.billing_variant_id ?? null,
            client_id: outboundPayload.client_id ?? null,
            driving_distance_km: outboundPayload.driving_distance_km ?? null,
            scheduled_at: outboundPayload.scheduled_at ?? null,
            kts_document_applies: outboundPayload.kts_document_applies ?? false,
            net_price: null,
            base_net_price: null,
            manual_gross_price: null
          },
          pricingCtx
        )
      };

      const outboundId = await insertIfAbsent(outboundWithPrice, {
        client_id: client.id,
        rule_id: rule.id,
        requested_date: dateStr,
        leg: 'outbound'
      });

      if (!outboundId) continue;

      if (returnMode === 'none') continue;

      if (returnMode === 'exact' && !rule.return_time) continue;

      const returnExceptionKey =
        returnMode === 'time_tbd'
          ? RECURRING_RETURN_TBD_EXCEPTION_PICKUP_TIME
          : clockToHhMmSs(rule.return_time!);

      const returnScheduledIso =
        returnMode === 'exact'
          ? scheduledIsoFromBerlinCalendarAndClock(
              dateStr,
              exceptions?.find(
                (e) =>
                  e.rule_id === rule.id &&
                  e.exception_date === dateStr &&
                  e.original_pickup_time === returnExceptionKey
              )?.modified_pickup_time || rule.return_time!
            )
          : null;

      const returnPayload = await buildTripPayload({
        rule,
        client,
        clientName,
        dateStr,
        isReturnTrip: true,
        returnMode,
        exceptionTimeKey: returnExceptionKey,
        scheduledAtIso: returnScheduledIso,
        linkedTripId: outboundId,
        outboundLinkType: null,
        billing_type_id: rule.billing_variants?.billing_type_id || null
      });

      if (!returnPayload) continue;

      const returnWithPrice: TripInsert = {
        ...returnPayload,
        ...computeTripPrice(
          {
            payer_id: returnPayload.payer_id ?? null,
            billing_type_id: returnPayload.billing_type_id ?? null,
            billing_variant_id: returnPayload.billing_variant_id ?? null,
            client_id: returnPayload.client_id ?? null,
            driving_distance_km: returnPayload.driving_distance_km ?? null,
            scheduled_at: returnPayload.scheduled_at ?? null,
            kts_document_applies: returnPayload.kts_document_applies ?? false,
            net_price: null,
            base_net_price: null,
            manual_gross_price: null
          },
          pricingCtx
        )
      };

      const returnId = await insertIfAbsent(returnWithPrice, {
        client_id: client.id,
        rule_id: rule.id,
        requested_date: dateStr,
        leg: 'return'
      });

      if (!returnId) continue;

      const { error: linkOutError } = await supabase
        .from('trips')
        .update({
          linked_trip_id: returnId,
          link_type: 'outbound'
        })
        .eq('id', outboundId);

      if (linkOutError) {
        errorCount++;
        console.error(
          '[generate-recurring-trips] outbound link update failed:',
          linkOutError
        );
      }
    }
  }

  return {
    generated: tripsInserted,
    skipped: tripsSkipped,
    errors: errorCount
  };
}
