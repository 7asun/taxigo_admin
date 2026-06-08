'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteAdminShiftAction } from '@/features/driver-planning/actions';
import { invalidateShiftAndAvailabilityCaches } from '@/lib/driver-availability-cache';
import { shiftReconciliationKeys } from '../lib/query-keys';

export function useDeleteIstZeitInline(driverId: string, date: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteAdminShiftAction(driverId, date),
    onSuccess: (result) => {
      if (!result.success) return;
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.summaries(driverId)
      });
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.record(driverId, date)
      });
      void queryClient.invalidateQueries({
        queryKey: ['admin-shift', driverId, date]
      });
      invalidateShiftAndAvailabilityCaches(queryClient, date);
    }
  });
}
