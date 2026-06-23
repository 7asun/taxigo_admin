import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useOptionalTripsRscRefresh } from '@/features/trips/providers';
import { invalidateAfterTripSave } from '@/features/trips/lib/invalidate-after-trip-save';

import type { Trip } from '@/features/trips/api/trips.service';
import {
  cancelNonRecurringTrip,
  cancelNonRecurringTripAndPaired,
  cancelRecurringSeries,
  skipRecurringOccurrence,
  skipRecurringOccurrenceAndPaired,
  type CancelResult,
  type TripCancelMode
} from '@/features/trips/api/recurring-exceptions.actions';

export function useTripCancellation() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const optionalRscRefresh = useOptionalTripsRscRefresh();
  const [isLoading, setIsLoading] = useState(false);

  const cancelTrip = async (
    trip: Trip,
    mode: TripCancelMode,
    options?: { source?: string; reason?: string }
  ) => {
    const source = options?.source || 'Manually cancelled via Trips UI';
    const reason = options?.reason;

    try {
      setIsLoading(true);

      let result: CancelResult;

      switch (mode) {
        case 'cancel-nonrecurring-and-paired':
          result = await cancelNonRecurringTripAndPaired(trip, reason);
          break;
        case 'skip-occurrence':
          result = await skipRecurringOccurrence(trip, source, reason);
          break;
        case 'skip-occurrence-and-paired':
          result = await skipRecurringOccurrenceAndPaired(trip, source, reason);
          break;
        case 'cancel-series':
          result = await cancelRecurringSeries(trip, reason);
          break;
        case 'single-nonrecurring':
        default:
          result = await cancelNonRecurringTrip(trip, reason);
          break;
      }

      if (!result.ok) {
        toast.error(
          'Fehler beim Stornieren der Fahrt: ' +
            (result.error ?? 'Unbekannter Fehler')
        );
        return;
      }

      switch (mode) {
        case 'cancel-nonrecurring-and-paired':
          toast.success('Hin- und Rückfahrt wurden storniert.');
          break;
        case 'skip-occurrence':
          toast.success(
            'Wiederkehrende Fahrt wurde für dieses Datum storniert.'
          );
          break;
        case 'skip-occurrence-and-paired':
          toast.success(
            'Hin- und Rückfahrt wurden für dieses Datum storniert.'
          );
          break;
        case 'cancel-series':
          toast.success(
            'Wiederkehrende Serie wurde beendet und zukünftige Fahrten storniert.'
          );
          break;
        default:
          toast.success('Fahrt wurde erfolgreich storniert.');
      }

      if (optionalRscRefresh) {
        await optionalRscRefresh.refreshTripsPage();
      } else {
        await router.refresh();
      }

      const pairedModes = new Set<TripCancelMode>([
        'cancel-nonrecurring-and-paired',
        'skip-occurrence-and-paired'
      ]);
      const tripIds =
        pairedModes.has(mode) && trip.linked_trip_id
          ? [trip.id, trip.linked_trip_id]
          : [trip.id];

      // WHY: cancelled trips must leave planning widgets immediately
      await invalidateAfterTripSave(queryClient, {
        tripIds,
        patch: { status: 'cancelled' },
        includePlanningWidgets: true,
        includeTripList: false
      });
    } finally {
      setIsLoading(false);
    }
  };

  return {
    cancelTrip,
    isLoading
  };
}
