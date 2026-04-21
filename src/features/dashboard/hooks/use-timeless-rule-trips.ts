import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { Trip } from '@/features/trips/api/trips.service';
import {
  billingFamilyFromEmbed,
  formatBillingDisplayLabel
} from '@/features/trips/lib/format-billing-display-label';
import { tripKeys } from '@/query/keys';
import { createDebouncedInvalidateByQueryKey } from '@/query/realtime-bridge';

const TIMELESS_WIDGET_LOOKAHEAD_DAYS = 1;

/** Trip row with Kostenträger / Abrechnung embeds from the timeless widget query. */
export type TimelessWidgetTrip = Trip & {
  payer?: { name: string | null } | null;
  billing_variant?: {
    name: string | null;
    code: string | null;
    billing_types?: unknown;
  } | null;
};

export type TimelessRulePair = {
  id: string;
  client_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  requested_date: string;
  payer_name: string | null;
  billing_label: string;
  billing_color: string | null;
  outbound: TimelessWidgetTrip | null;
  return: TimelessWidgetTrip | null;
};

const TIMELESS_TRIP_EMBEDS =
  'payer:payers(name), billing_variant:billing_variants!trips_billing_variant_id_fkey(name, code, billing_types!billing_variants_billing_type_id_fkey(name, color))';

type TripPartnerRow = Pick<
  TimelessWidgetTrip,
  | 'id'
  | 'scheduled_at'
  | 'status'
  | 'link_type'
  | 'requested_date'
  | 'rule_id'
  | 'client_id'
  | 'client_name'
  | 'pickup_address'
  | 'dropoff_address'
  | 'driver_id'
  | 'linked_trip_id'
  | 'payer_id'
  | 'billing_variant_id'
  | 'payer'
  | 'billing_variant'
>;

function billingSummaryForPair(
  outbound: TimelessWidgetTrip | null,
  ret: TimelessWidgetTrip | null
): Pick<TimelessRulePair, 'payer_name' | 'billing_label' | 'billing_color'> {
  const payerName =
    outbound?.payer?.name?.trim() || ret?.payer?.name?.trim() || null;
  const bv = outbound?.billing_variant ?? ret?.billing_variant ?? null;
  const label = formatBillingDisplayLabel(bv).trim();
  const fam = billingFamilyFromEmbed(bv?.billing_types);
  return {
    payer_name: payerName,
    billing_label: label,
    billing_color: fam?.color ?? null
  };
}

function isOutboundish(linkType: string | null): boolean {
  return linkType == null || linkType === 'outbound';
}

function sortByClientNameAsc(a: TimelessRulePair, b: TimelessRulePair): number {
  const an = (a.client_name ?? '').trim();
  const bn = (b.client_name ?? '').trim();
  if (an && bn) return an.localeCompare(bn, 'de');
  if (an) return -1;
  if (bn) return 1;
  return 0;
}

export async function fetchTimelessRulePairs(
  requestedDate: string
): Promise<TimelessRulePair[]> {
  const supabase = createClient();

  const { data: rowsRaw, error } = await supabase
    .from('trips')
    .select(`*, requested_date, ${TIMELESS_TRIP_EMBEDS}`)
    .not('rule_id', 'is', null)
    .is('scheduled_at', null)
    .eq('requested_date', requestedDate)
    .not('status', 'in', '("cancelled","completed")');

  if (error) throw error;

  const rows = (rowsRaw ?? []) as TimelessWidgetTrip[];

  const linkedIds = Array.from(
    new Set(
      rows.map((t) => t.linked_trip_id).filter((id): id is string => !!id)
    )
  );

  const partnerMap = new Map<string, TripPartnerRow>();
  if (linkedIds.length > 0) {
    const { data: partnerRowsRaw, error: partnerError } = await supabase
      .from('trips')
      .select(
        `id, scheduled_at, status, link_type, requested_date, rule_id, client_id, client_name, pickup_address, dropoff_address, driver_id, linked_trip_id, payer_id, billing_variant_id, ${TIMELESS_TRIP_EMBEDS}`
      )
      .in('id', linkedIds);

    if (partnerError) throw partnerError;

    for (const r of (partnerRowsRaw ?? []) as unknown as TripPartnerRow[]) {
      partnerMap.set(r.id, r);
    }
  }

  const pairsByKey = new Map<string, TimelessRulePair>();

  const keyFor = (t: TripPartnerRow): string =>
    `${t.rule_id}|${t.requested_date}|${t.client_id}`;

  const addPair = (pair: TimelessRulePair, dedupKey: string) => {
    if (!pairsByKey.has(dedupKey)) {
      pairsByKey.set(dedupKey, pair);
    }
  };

  // Pair outbound-ish legs first so a linked return row cannot “win” the slot.
  for (const trip of rows) {
    if (!isOutboundish(trip.link_type)) continue;
    if (!trip.rule_id || !trip.client_id || !trip.requested_date) continue;
    const dedupKey = keyFor(trip as TripPartnerRow);

    const partner = trip.linked_trip_id
      ? (partnerMap.get(trip.linked_trip_id) ?? null)
      : null;

    const display = {
      client_name: trip.client_name ?? partner?.client_name ?? null,
      pickup_address: trip.pickup_address ?? partner?.pickup_address ?? null,
      dropoff_address: trip.dropoff_address ?? partner?.dropoff_address ?? null
    };

    const partnerTrip = partner ? (partner as TimelessWidgetTrip | null) : null;
    const billing = billingSummaryForPair(trip, partnerTrip);

    addPair(
      {
        id: trip.id,
        ...display,
        ...billing,
        requested_date: trip.requested_date,
        outbound: trip,
        return: partnerTrip
      },
      dedupKey
    );
  }

  // Then pair return legs that were not already covered.
  for (const trip of rows) {
    if (trip.link_type !== 'return') continue;
    if (!trip.rule_id || !trip.client_id || !trip.requested_date) continue;
    const dedupKey = keyFor(trip as TripPartnerRow);
    if (pairsByKey.has(dedupKey)) continue;

    const partner = trip.linked_trip_id
      ? (partnerMap.get(trip.linked_trip_id) ?? null)
      : null;

    const display = {
      client_name: partner?.client_name ?? trip.client_name ?? null,
      pickup_address: partner?.pickup_address ?? trip.pickup_address ?? null,
      dropoff_address: partner?.dropoff_address ?? trip.dropoff_address ?? null
    };

    const partnerTrip =
      partner && isOutboundish(partner.link_type)
        ? (partner as TimelessWidgetTrip)
        : (partner as TimelessWidgetTrip | null);
    const billing = billingSummaryForPair(partnerTrip, trip);

    addPair(
      {
        id: partner?.id ?? trip.id,
        ...display,
        ...billing,
        requested_date: trip.requested_date,
        outbound: partnerTrip,
        return: trip
      },
      dedupKey
    );
  }

  return Array.from(pairsByKey.values()).sort(sortByClientNameAsc);
}

export function useTimelessRuleTrips() {
  const queryClient = useQueryClient();

  // Tomorrow filter lives in the hook so the widget stays presentational and the
  // query key is always derived from a single source of truth.
  const tomorrowDateStr = format(
    addDays(new Date(), TIMELESS_WIDGET_LOOKAHEAD_DAYS),
    'yyyy-MM-dd'
  );

  const query = useQuery({
    queryKey: tripKeys.timelessRuleTrips(tomorrowDateStr),
    queryFn: () => fetchTimelessRulePairs(tomorrowDateStr),
    staleTime: 60_000
  });

  useEffect(() => {
    const { schedule, cancel } = createDebouncedInvalidateByQueryKey(
      queryClient,
      tripKeys.timelessRuleTripsRoot,
      400
    );

    const supabase = createClient();
    const channel = supabase
      .channel('timeless-rule-trips-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trips' },
        () => {
          schedule();
        }
      )
      .subscribe();

    return () => {
      cancel();
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  useEffect(() => {
    if (!query.error || query.data) return;
    toast.error(
      `Fehler beim Laden der timeless rule trips: ${(query.error as Error).message}`
    );
  }, [query.error, query.data]);

  return {
    pairs: query.data ?? [],
    isLoading: query.isLoading
  };
}
