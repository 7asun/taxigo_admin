'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tripKeys } from '@/query/keys';
import { tripsService, type UpdateTrip } from '../api/trips.service';

/**
 * Updates a single trip via `tripsService.updateTrip` and **invalidates** the detail query
 * (Option A — no optimistic `setQueryData` merge).
 *
 * Also invalidates `tripKeys.all` to refresh dashboard stats ("Fahrten heute", "Umsatz heute")
 * since trip updates can change scheduled_at, price, or status — all of which affect stat calculations.
 */
export function useUpdateTripMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTrip }) =>
      tripsService.updateTrip(id, patch),
    onSuccess: (_data, { id }) => {
      // Invalidate detail query for the trip sheet
      void queryClient.invalidateQueries({ queryKey: tripKeys.detail(id) });
      // Invalidate all trips to refresh dashboard stats
      void queryClient.invalidateQueries({ queryKey: tripKeys.all });
    }
  });
}
