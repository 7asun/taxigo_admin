'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { tripsService, type Trip } from '@/features/trips/api/trips.service';
import { buildAssignmentPatch } from '@/features/trips/lib/trip-assignee';
import { invalidateAfterTripSave } from '@/features/trips/lib/invalidate-after-trip-save';
import { createClient } from '@/lib/supabase/client';

type AssignDriverInput = {
  trip: Trip & { group_id?: string | null };
  newDriverId: string | null;
};

/**
 * Immediate-save driver assignment for the overview widget (no pending-changes store).
 *
 * WHY not `useKanbanPendingStore`: the widget saves on every select change; v2 DnD
 * should call the same mutation from `onDragEnd` instead of staging patches.
 */
export function useWidgetTripAssignment() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ trip, newDriverId }: AssignDriverInput) => {
      const patch = buildAssignmentPatch(trip, { driver_id: newDriverId });

      if (trip.group_id) {
        const supabase = createClient();
        const { error } = await supabase
          .from('trips')
          .update(patch)
          .eq('group_id', trip.group_id);

        if (error) throw error;
        return;
      }

      await tripsService.updateTrip(trip.id, patch);
    },
    onSuccess: (_data, { trip }) => {
      toast.success(
        trip.group_id
          ? 'Fahrer für die Gruppe aktualisiert'
          : 'Fahrer aktualisiert'
      );
    },
    onSettled: async (_data, _err, { trip, newDriverId }) => {
      const patch = buildAssignmentPatch(trip, { driver_id: newDriverId });
      await invalidateAfterTripSave(queryClient, {
        tripIds: [trip.id],
        patch,
        // WHY: driver_id assignee change removes row from Offene Touren; 'auto' busts roots.
        includePlanningWidgets: 'auto'
      });
    },
    onError: () => {
      toast.error('Zuweisung fehlgeschlagen. Bitte erneut versuchen.');
    }
  });

  return {
    assignDriver: mutation.mutate,
    isAssigning: mutation.isPending,
    pendingTripId: mutation.isPending ? mutation.variables?.trip.id : null
  };
}
