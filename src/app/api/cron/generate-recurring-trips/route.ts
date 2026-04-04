import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { RRule, rrulestr } from 'rrule';
import {
  addDays,
  startOfDay,
  endOfDay,
  format,
  isAfter,
  isBefore
} from 'date-fns';
import type { Database } from '@/types/database.types';
import {
  geocodeAddressLineToStructured,
  type GeocodedAddressLineResult
} from '@/lib/google-geocoding';
import {
  getDrivingMetrics,
  type DrivingMetrics
} from '@/lib/google-directions';
import {
  RECURRING_RETURN_TBD_EXCEPTION_PICKUP_TIME,
  recurringReturnModeFromRow,
  type RecurringRuleReturnMode
} from '@/features/trips/lib/recurring-return-mode';

export const dynamic = 'force-dynamic';

type TripInsert = Database['public']['Tables']['trips']['Insert'];
type RecurringRuleRow = Database['public']['Tables']['recurring_rules']['Row'];

function clockToHhMmSs(clock: string): string {
  const s = clock.trim();
  if (s.length >= 8 && s[2] === ':') {
    return s.slice(0, 8);
  }
  if (s.length === 5) {
    return `${s}:00`;
  }
  return s;
}

function toScheduledIso(dateStr: string, timeHhMmSs: string): string {
  const t = clockToHhMmSs(timeHhMmSs);
  return new Date(`${dateStr}T${t}`).toISOString();
}

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createClient<Database>(supabaseUrl, supabaseKey);

    const todayLocal = startOfDay(new Date());
    const windowEndLocal = endOfDay(addDays(todayLocal, 14));

    const { data: rules, error: rulesError } = await supabase
      .from('recurring_rules')
      .select('*')
      .eq('is_active', true);

    if (rulesError) throw rulesError;
    if (!rules || rules.length === 0) {
      return NextResponse.json({ message: 'No active rules found' });
    }

    const { data: exceptions, error: exceptionsError } = await supabase
      .from('recurring_rule_exceptions')
      .select('*')
      .in(
        'rule_id',
        rules.map((r) => r.id)
      )
      .gte('exception_date', format(todayLocal, 'yyyy-MM-dd'))
      .lte('exception_date', format(windowEndLocal, 'yyyy-MM-dd'));

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

    let tripsInserted = 0;

    async function buildTripPayload(params: {
      rule: RecurringRuleRow;
      client: Database['public']['Tables']['clients']['Row'];
      clientName: string;
      dateStr: string;
      isReturnTrip: boolean;
      returnMode: RecurringRuleReturnMode;
      /** HH:mm:ss for exception matching (`original_pickup_time`) */
      exceptionTimeKey: string;
      /** ISO string or null when the leg has no clock time (Zeitabsprache return) */
      scheduledAtIso: string | null;
      linkedTripId: string | null;
      outboundLinkType: 'outbound' | null;
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
        outboundLinkType
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
        if (!pt) return null;
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

      const pickupGeo = await resolveGeoLine(pickupAddress);
      const dropoffGeo = await resolveGeoLine(dropoffAddress);
      const geodataOk = !!pickupGeo && !!dropoffGeo;

      let driving_distance_km: number | null = null;
      let driving_duration_seconds: number | null = null;
      if (pickupGeo && dropoffGeo) {
        const metricsKey = `${pickupGeo.lat},${pickupGeo.lng}|${dropoffGeo.lat},${dropoffGeo.lng}`;
        if (!drivingMetricsCache.has(metricsKey)) {
          drivingMetricsCache.set(
            metricsKey,
            await getDrivingMetrics(
              pickupGeo.lat,
              pickupGeo.lng,
              dropoffGeo.lat,
              dropoffGeo.lng
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

      // no_invoice_required, fremdfirma_id, fremdfirma_payment_mode, fremdfirma_cost
      // are mirrored from recurring_rules — same pattern as kts_document_applies.
      // Admin can override on individual generated trips after creation.

      return {
        company_id: client.company_id,
        client_id: client.id,
        client_name: clientName || '',
        client_phone: client.phone || '',
        payer_id: rule.payer_id,
        billing_variant_id: rule.billing_variant_id,
        kts_document_applies: rule.kts_document_applies ?? false,
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
        pickup_station: null,
        dropoff_address: dropoffAddress,
        dropoff_street: dropoffGeo?.street ?? null,
        dropoff_street_number: dropoffGeo?.street_number ?? null,
        dropoff_zip_code: dropoffGeo?.zip_code ?? null,
        dropoff_city: dropoffGeo?.city ?? null,
        dropoff_lat: dropoffGeo?.lat ?? null,
        dropoff_lng: dropoffGeo?.lng ?? null,
        dropoff_station: null,
        driving_distance_km,
        driving_duration_seconds,
        has_missing_geodata: !geodataOk,
        scheduled_at: scheduledAtIso,
        rule_id: rule.id,
        link_type,
        linked_trip_id: linkedTripId
      };
    }

    async function findExistingRecurringLegId(q: {
      client_id: string;
      rule_id: string;
      scheduled_at: string | null;
      requested_date: string;
      leg: 'outbound' | 'return';
    }): Promise<string | null> {
      let query = supabase
        .from('trips')
        .select('id')
        .eq('client_id', q.client_id)
        .eq('rule_id', q.rule_id)
        .eq('requested_date', q.requested_date);

      if (q.scheduled_at === null) {
        query = query.is('scheduled_at', null);
      } else {
        query = query.eq('scheduled_at', q.scheduled_at);
      }

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
        scheduled_at: string | null;
        requested_date: string;
        leg: 'outbound' | 'return';
      }
    ): Promise<string | null> {
      const existing = await findExistingRecurringLegId(dedupKey);
      if (existing) return existing;

      const { data, error } = await supabase
        .from('trips')
        .insert(row)
        .select('id')
        .single();

      if (error) {
        console.error('[generate-recurring-trips] insert failed:', error);
        return null;
      }
      tripsInserted++;
      return data.id;
    }

    for (const rule of rules) {
      const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', rule.client_id)
        .single();

      if (clientError || !client) continue;

      if (!rule.payer_id || !rule.billing_variant_id) {
        console.warn(
          `[generate-recurring-trips] Skipping rule ${rule.id}: missing payer_id or billing_variant_id (edit and save the rule in Admin).`
        );
        continue;
      }

      const clientName =
        (client.is_company
          ? client.company_name
          : `${client.first_name || ''} ${client.last_name || ''}`.trim()) ||
        '';

      const ruleStartDateLocal = startOfDay(new Date(rule.start_date));
      const ruleEndDateLocal = rule.end_date
        ? endOfDay(new Date(rule.end_date))
        : windowEndLocal;

      const dtStartUTC = new Date(
        Date.UTC(
          ruleStartDateLocal.getFullYear(),
          ruleStartDateLocal.getMonth(),
          ruleStartDateLocal.getDate(),
          0,
          0,
          0
        )
      );

      let rruleObj: RRule;
      try {
        const dtStartStr = format(dtStartUTC, "yyyyMMdd'T'HHmmss'Z'");
        const rruleStr = `DTSTART:${dtStartStr}\n${rule.rrule_string}`;
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

      const searchStartUTC = new Date(
        Date.UTC(
          searchStartLocal.getFullYear(),
          searchStartLocal.getMonth(),
          searchStartLocal.getDate()
        )
      );
      const searchEndUTC = new Date(
        Date.UTC(
          searchEndLocal.getFullYear(),
          searchEndLocal.getMonth(),
          searchEndLocal.getDate(),
          23,
          59,
          59
        )
      );

      const occurrencesUTC = rruleObj.between(
        searchStartUTC,
        searchEndUTC,
        true
      );

      const returnMode = recurringReturnModeFromRow(rule);

      for (const dateUTC of occurrencesUTC) {
        const dateStr = dateUTC.toISOString().split('T')[0];

        const outboundExceptionKey = clockToHhMmSs(rule.pickup_time);
        const outboundScheduledIso = toScheduledIso(
          dateStr,
          exceptions?.find(
            (e) =>
              e.rule_id === rule.id &&
              e.exception_date === dateStr &&
              e.original_pickup_time === outboundExceptionKey
          )?.modified_pickup_time || rule.pickup_time
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
          outboundLinkType: null
        });

        if (!outboundPayload) continue;

        const outboundId = await insertIfAbsent(outboundPayload, {
          client_id: client.id,
          rule_id: rule.id,
          scheduled_at: outboundScheduledIso,
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
            ? toScheduledIso(
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
          outboundLinkType: null
        });

        if (!returnPayload) continue;

        const returnId = await insertIfAbsent(returnPayload, {
          client_id: client.id,
          rule_id: rule.id,
          scheduled_at: returnScheduledIso,
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
          console.error(
            '[generate-recurring-trips] outbound link update failed:',
            linkOutError
          );
        }
      }
    }

    return NextResponse.json({
      message: `Successfully processed recurring rules.`,
      trips_inserted: tripsInserted
    });
  } catch (error: any) {
    console.error('Cron Error generating recurring trips:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
