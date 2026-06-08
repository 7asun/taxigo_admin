'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { reopenReconciliationAction } from '../actions';
import { shiftReconciliationKeys } from '../lib/query-keys';

export function useReopenReconciliation(driverId: string, date: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => reopenReconciliationAction(driverId, date),
    onSuccess: (result) => {
      if (!result.success) return;
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.record(driverId, date)
      });
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.summaries(driverId)
      });
    }
  });
}
