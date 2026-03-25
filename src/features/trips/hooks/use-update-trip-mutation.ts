'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tripKeys } from '@/query/keys';
import { tripsService, type UpdateTrip } from '../api/trips.service';

/**
 * Updates a single trip via `tripsService.updateTrip` and **invalidates** the detail query
 * (Option A — no optimistic `setQueryData` merge).
 */
export function useUpdateTripMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTrip }) =>
      tripsService.updateTrip(id, patch),
    onSuccess: (_data, { id }) => {
      void queryClient.invalidateQueries({ queryKey: tripKeys.detail(id) });
    }
  });
}
