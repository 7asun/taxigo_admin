'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tripsService } from '@/features/trips/api/trips.service';
import {
  getZonedDayBoundsIso,
  isYmdString
} from '@/features/trips/lib/trip-business-date';
import { createClient } from '@/lib/supabase/client';
import { tripKeys } from '@/query/keys';
import { createDebouncedInvalidateByQueryKey } from '@/query/realtime-bridge';

/** Last instant inside a Berlin calendar day (for PostgREST `.lte` on `scheduled_at`). */
function zonedDayEndInclusiveIso(ymd: string): string {
  const { endExclusiveISO } = getZonedDayBoundsIso(ymd);
  return new Date(new Date(endExclusiveISO).getTime() - 1).toISOString();
}

function widgetQueryKey(dateYmd: string) {
  return [...tripKeys.all, 'widget', dateYmd] as const;
}

/**
 * Date-scoped trips for the header overview widget.
 *
 * WHY separate from `useTrips` / `useUpcomingTrips`: the widget mounts globally in
 * the dashboard header and must use TanStack Query caching plus a single debounced
 * realtime channel — not per-mount fetches or filter-scoped channels.
 */
export function useTripsOverviewWidget(
  dateYmd: string,
  options?: { enabled?: boolean }
) {
  const queryClient = useQueryClient();
  const queryKey = widgetQueryKey(dateYmd);
  const enabled = (options?.enabled ?? true) && isYmdString(dateYmd);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { startISO } = getZonedDayBoundsIso(dateYmd);
      const endISO = zonedDayEndInclusiveIso(dateYmd);
      return tripsService.getUpcomingTrips(startISO, endISO);
    },
    enabled,
    staleTime: 60_000
  });

  useEffect(() => {
    if (!enabled) return;

    const key = widgetQueryKey(dateYmd);
    const { schedule, cancel } = createDebouncedInvalidateByQueryKey(
      queryClient,
      key,
      400
    );

    const supabase = createClient();
    const channel = supabase
      .channel('trips-overview-widget-sync')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trips'
        },
        () => {
          schedule();
        }
      )
      .subscribe();

    return () => {
      cancel();
      supabase.removeChannel(channel);
    };
  }, [dateYmd, queryClient, enabled]);

  return {
    trips: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError
  };
}
