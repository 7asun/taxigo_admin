import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { tripsService, type Trip } from '../api/trips.service';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { tripKeys } from '@/query/keys';
import {
  createDebouncedInvalidateByQueryKey,
  createDebouncedTripDetailInvalidation
} from '@/query/realtime-bridge';

/**
 * Fetches all trips for the dashboard stats ("Fahrten heute", "Umsatz heute").
 *
 * Uses TanStack Query with key `tripKeys.all` so that trip mutations (create, update, delete)
 * can invalidate this cache and trigger automatic stat refreshes.
 *
 * The Supabase realtime subscription invalidates the query key instead of refetching
 * directly — this ensures consistency with React Query's caching layer and allows
 * mutations to trigger the same refresh mechanism.
 */
export function useTrips() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: tripKeys.all,
    queryFn: () => tripsService.getTrips(),
    staleTime: 60_000 // Consistent with global default
  });

  // Set up Supabase realtime subscription to invalidate the query on any trips table change
  useEffect(() => {
    const { schedule, cancel } = createDebouncedInvalidateByQueryKey(
      queryClient,
      tripKeys.all,
      400
    );

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
          // Invalidate the query key instead of fetching directly — this leverages
          // React Query's caching and ensures mutations use the same refresh mechanism
          schedule();
        }
      )
      .subscribe();

    return () => {
      cancel();
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  // Show error toast when query fails
  useEffect(() => {
    if (!query.error || query.data) return;
    toast.error(`Failed to fetch trips: ${(query.error as Error).message}`);
  }, [query.error, query.data]);

  // Stable refresh function for backward compatibility
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: tripKeys.all });
  }, [queryClient]);

  return {
    trips: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    refresh
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
