'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { updateTripManualPriceAction } from '../actions';
import { shiftReconciliationKeys } from '../lib/query-keys';

export function useUpdateTripManualPrice(driverId: string, date: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      tripId,
      manualGrossPrice
    }: {
      tripId: string;
      manualGrossPrice: number | null;
    }) => updateTripManualPriceAction(tripId, manualGrossPrice),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.trips(driverId, date)
      });
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.summaries(driverId)
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Preis konnte nicht gespeichert werden.');
    }
  });
}
