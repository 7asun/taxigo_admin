'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tripKeys } from '@/query/keys';
import { tripsService, type Trip, type UpdateTrip } from '../api/trips.service';

/**
 * Updates a single trip via `tripsService.updateTrip` with an **optimistic** merge into
 * `tripKeys.detail(id)`, then reconciles via `invalidateQueries` on settle (success or error).
 *
 * `tripKeys.all` is invalidated on settle so dashboard stats ("Fahrten heute", "Umsatz heute")
 * stay consistent — same as before, but not merged optimistically.
 */
export function useUpdateTripMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTrip }) =>
      tripsService.updateTrip(id, patch),

    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: tripKeys.detail(id) });

      const previousTrip = queryClient.getQueryData<Trip>(tripKeys.detail(id));

      if (previousTrip) {
        queryClient.setQueryData<Trip>(tripKeys.detail(id), {
          ...previousTrip,
          ...patch
        });
      }

      return { previousTrip };
    },

    onError: (_err, { id }, context) => {
      if (context?.previousTrip) {
        queryClient.setQueryData(tripKeys.detail(id), context.previousTrip);
      }
    },

    onSettled: (_data, _err, { id }) => {
      void queryClient.invalidateQueries({ queryKey: tripKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: tripKeys.all });
    }
  });
}
