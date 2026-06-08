'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveIstZeitInlineAction } from '../actions';
import type { SaveIstZeitInlineParams } from '../api/shift-reconciliations.service';
import { shiftReconciliationKeys } from '../lib/query-keys';

export function useSaveIstZeitInline(driverId: string, date: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: SaveIstZeitInlineParams) =>
      saveIstZeitInlineAction(params),
    onSuccess: (result) => {
      if (!result.success) return;
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.summaries(driverId)
      });
      void queryClient.invalidateQueries({
        queryKey: shiftReconciliationKeys.record(driverId, date)
      });
    }
  });
}
