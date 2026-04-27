'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { confirmShiftReconciliationAction } from '../actions';
import type { ConfirmShiftParams } from '../api/shift-reconciliations.service';
import { shiftReconciliationKeys } from '../lib/query-keys';

export function useConfirmShift(driverId: string, date: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: ConfirmShiftParams) =>
      confirmShiftReconciliationAction(params),
    onSuccess: () => {
      toast.success('Schicht bestätigt.');
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.record(driverId, date)
      });
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.trips(driverId, date)
      });
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.summaries(driverId)
      });
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Schicht konnte nicht bestätigt werden.');
    }
  });
}
