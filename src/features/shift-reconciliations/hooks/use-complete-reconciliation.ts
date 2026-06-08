'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { completeReconciliationAction } from '../actions';
import type { CompleteReconciliationParams } from '../api/shift-reconciliations.service';
import { shiftReconciliationKeys } from '../lib/query-keys';

export function useCompleteReconciliation(driverId: string, date: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CompleteReconciliationParams) =>
      completeReconciliationAction(params),
    onSuccess: (result) => {
      if (!result.success) return;
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.record(driverId, date)
      });
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.trips(driverId, date)
      });
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.summaries(driverId)
      });
    }
  });
}
