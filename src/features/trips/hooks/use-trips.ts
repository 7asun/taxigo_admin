import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tripsService, type Trip } from '../api/trips.service';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { tripKeys } from '@/query/keys';
import { createDebouncedTripDetailInvalidation } from '@/query/realtime-bridge';

export function useTrips() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchTrips = async () => {
    try {
      setIsLoading(true);
      const data = await tripsService.getTrips();
      setTrips(data);
      setError(null);
    } catch (err) {
      const error = err as Error;
      setError(error);
      toast.error(`Failed to fetch trips: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTrips();
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('trips-all-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trips'
        },
        (payload) => {
          console.log('Real-time update for all trips received:', payload);
          fetchTrips();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return {
    trips,
    isLoading,
    error,
    refresh: fetchTrips
  };
}

const TRIP_DETAIL_DISABLED_KEY = ['trips', 'detail', '__none__'] as const;

/**
 * Trip detail with TanStack Query + Supabase realtime **invalidation** (not full refetch
 * with `setIsLoading(true)`), so the sheet does not flash the skeleton on background updates.
 *
 * Use **`isLoading`** for the initial skeleton — it is false when cached data exists while refetching.
 */
export function useTripQuery(id: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: id ? tripKeys.detail(id) : TRIP_DETAIL_DISABLED_KEY,
    queryFn: () => tripsService.getTripById(id!),
    enabled: !!id,
    /** Slightly longer than global default — detail joins are heavier. */
    staleTime: 90_000
  });

  useEffect(() => {
    if (!id) return;

    const { schedule, cancel } = createDebouncedTripDetailInvalidation(
      queryClient,
      id
    );

    const supabase = createClient();
    const channel = supabase
      .channel(`trip-${id}-changes`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trips',
          filter: `id=eq.${id}`
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
  }, [id, queryClient]);

  useEffect(() => {
    if (!query.error || query.data) return;
    toast.error(
      `Failed to fetch trip details: ${(query.error as Error).message}`
    );
  }, [query.error, query.data]);

  return {
    trip: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error as Error | null,
    isFetching: query.isFetching,
    refetch: query.refetch
  };
}

/** @deprecated Use `useTripQuery` — alias kept for call sites that still import `useTrip`. */
export function useTrip(id: string | null) {
  return useTripQuery(id);
}
