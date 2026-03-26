import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { startOfWeek, endOfWeek } from 'date-fns';
import type { Trip } from '@/features/trips/api/trips.service';
import { tripKeys, type UnplannedTripsFilter } from '@/query/keys';
import { createDebouncedInvalidateByQueryKey } from '@/query/realtime-bridge';

export type UnplannedTrip = Trip & {
  requested_date?: string | null;
  linked_trip?: {
    scheduled_at: string | null;
    status: string | null;
    link_type: string | null;
  } | null;
};

/** Same as `UnplannedTripsFilter` from `@/query/keys` — kept for existing imports. */
export type UnplannedFilter = UnplannedTripsFilter;

function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function isThisWeek(date: Date): boolean {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  return date >= weekStart && date <= weekEnd;
}

/**
 * Loads “unplanned” trips (no time and/or no driver), enriches linked outbound rows,
 * applies the dashboard tab filter, and sorts — used as the `queryFn` for
 * `tripKeys.unplanned(filter)`.
 */
export async function fetchUnplannedTrips(
  filter: UnplannedTripsFilter
): Promise<UnplannedTrip[]> {
  const supabase = createClient();

  const { data: unplannedRows, error: fetchError } = await supabase
    .from('trips')
    .select('*, requested_date')
    .or('scheduled_at.is.null,driver_id.is.null')
    .not('status', 'in', '("cancelled","completed")')
    .order('created_at', { ascending: false });

  if (fetchError) {
    throw fetchError;
  }

  const rows = (unplannedRows || []) as UnplannedTrip[];

  const linkedIds = Array.from(
    new Set(
      rows.map((t) => t.linked_trip_id).filter((id): id is string => !!id)
    )
  );

  type LinkedInfo = {
    scheduled_at: string | null;
    status: string | null;
    link_type: string | null;
  };
  let linkedMap: Record<string, LinkedInfo> = {};
  if (linkedIds.length > 0) {
    const { data: linkedRows } = await supabase
      .from('trips')
      .select('id, scheduled_at, status, link_type')
      .in('id', linkedIds);
    linkedMap = (linkedRows || []).reduce(
      (acc, r) => {
        acc[r.id] = {
          scheduled_at: r.scheduled_at ?? null,
          status: r.status ?? null,
          link_type: r.link_type ?? null
        };
        return acc;
      },
      {} as Record<string, LinkedInfo>
    );
  }

  const withLinked = rows.map((trip) => ({
    ...trip,
    linked_trip: trip.linked_trip_id
      ? (linkedMap[trip.linked_trip_id] ?? null)
      : null
  })) as UnplannedTrip[];

  const filtered =
    filter === 'all'
      ? withLinked
      : withLinked.filter((trip) => {
          const dateStr =
            trip.scheduled_at ??
            trip.linked_trip?.scheduled_at ??
            (trip.requested_date ? `${trip.requested_date}T12:00:00` : null);
          if (!dateStr) return false;
          const date = new Date(dateStr);
          if (filter === 'today') return isToday(date);
          if (filter === 'week') return isThisWeek(date);
          return true;
        });

  const sorted = [...filtered].sort((a, b) => {
    const aTime = a.scheduled_at ? new Date(a.scheduled_at).getTime() : null;
    const bTime = b.scheduled_at ? new Date(b.scheduled_at).getTime() : null;
    if (aTime !== null && bTime !== null) return aTime - bTime;
    if (aTime !== null) return -1;
    if (bTime !== null) return 1;
    return 0;
  });

  return sorted;
}

/**
 * Dashboard “Offene Touren” list — TanStack Query + `tripKeys.unplanned(filter)`.
 * Supabase realtime **invalidates** `tripKeys.unplannedRoot` (debounced) instead of
 * calling `setIsLoading(true)` on every change, so the card does not flash a full
 * skeleton on background updates.
 */
export function useUnplannedTrips(filter: UnplannedTripsFilter) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: tripKeys.unplanned(filter),
    queryFn: () => fetchUnplannedTrips(filter),
    staleTime: 60_000
  });

  useEffect(() => {
    const { schedule, cancel } = createDebouncedInvalidateByQueryKey(
      queryClient,
      tripKeys.unplannedRoot,
      400
    );

    const supabase = createClient();
    const channel = supabase
      .channel('unplanned-trips-changes')
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
      `Fehler beim Laden der offenen Touren: ${(query.error as Error).message}`
    );
  }, [query.error, query.data]);

  return {
    trips: query.data ?? [],
    /** Initial load only — stays false during background refetch (realtime / invalidate). */
    isLoading: query.isLoading,
    error: query.error as Error | null,
    /** Prefer `queryClient.invalidateQueries({ queryKey: tripKeys.unplannedRoot })` after writes. */
    refresh: query.refetch
  };
}
