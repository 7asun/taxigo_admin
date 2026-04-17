import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { Trip } from '@/features/trips/api/trips.service';
import { tripKeys } from '@/query/keys';
import { createDebouncedInvalidateByQueryKey } from '@/query/realtime-bridge';

const TIMELESS_WIDGET_LOOKAHEAD_DAYS = 1;

export type TimelessRulePair = {
  id: string;
  client_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  requested_date: string;
  outbound: Trip | null;
  return: Trip | null;
};

type TripPartnerRow = Pick<
  Trip,
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
>;

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
    .select('*, requested_date')
    .not('rule_id', 'is', null)
    .is('scheduled_at', null)
    .eq('requested_date', requestedDate)
    .not('status', 'in', '("cancelled","completed")');

  if (error) throw error;

  const rows = (rowsRaw ?? []) as Trip[];

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
        'id, scheduled_at, status, link_type, requested_date, rule_id, client_id, client_name, pickup_address, dropoff_address, driver_id, linked_trip_id'
      )
      .in('id', linkedIds);

    if (partnerError) throw partnerError;

    for (const r of (partnerRowsRaw ?? []) as TripPartnerRow[]) {
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

    addPair(
      {
        id: trip.id,
        ...display,
        requested_date: trip.requested_date,
        outbound: trip,
        return:
          partner && partner.link_type === 'return'
            ? (partner as Trip)
            : (partner as Trip | null)
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

    addPair(
      {
        id: partner?.id ?? trip.id,
        ...display,
        requested_date: trip.requested_date,
        outbound:
          partner && isOutboundish(partner.link_type)
            ? (partner as Trip)
            : (partner as Trip | null),
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
