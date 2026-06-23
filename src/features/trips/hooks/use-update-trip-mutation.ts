'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tripKeys } from '@/query/keys';
import { invalidateAfterTripSave } from '../lib/invalidate-after-trip-save';
import { tripsService, type Trip, type UpdateTrip } from '../api/trips.service';

/**
 * Updates a single trip via `tripsService.updateTrip` with an **optimistic** merge into
 * `tripKeys.detail(id)`, then reconciles via `invalidateAfterTripSave` on settle (success or error).
 *
 * List + detail invalidation and planning-widget busting are owned by the shared helper
 * (`includePlanningWidgets: 'auto'` inspects the patch).
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

    onSettled: async (_data, _err, { id, patch }) => {
      // WHY: 'auto' busts widget roots only for planning-relevant patches (scheduled_at,
      // driver_id, status, …). Notes/KTS/Reha/billing writes skip widget invalidation.
      await invalidateAfterTripSave(queryClient, {
        tripIds: [id],
        patch,
        includePlanningWidgets: 'auto',
        includeTripList: true
      });
    }
  });
}
