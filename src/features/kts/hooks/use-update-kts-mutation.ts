'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tripKeys } from '@/query/keys';
import type { Trip, UpdateTrip } from '@/features/trips/api/trips.service';
import { updateTripKts } from '@/features/kts/kts.service';

/**
 * KTS-field-only trip updates via `kts.service` (normalize + persist).
 * Cache semantics match `useUpdateTripMutation` for detail + list invalidation.
 */
export function useUpdateKtsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<UpdateTrip> }) =>
      updateTripKts(id, patch),

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
