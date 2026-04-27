'use client';

import { useQuery } from '@tanstack/react-query';
import { getShiftReconciliationRecordAction } from '../actions';
import { shiftReconciliationKeys } from '../lib/query-keys';
import type { ShiftReconciliationWithMeta } from '../types';

type UseShiftReconciliationOpts = {
  initialData?: ShiftReconciliationWithMeta | null;
};

export function useShiftReconciliationRecord(
  driverId: string | null,
  date: string | null,
  options?: UseShiftReconciliationOpts
) {
  const enabled = Boolean(driverId && date && date.length >= 10);

  return useQuery<ShiftReconciliationWithMeta | null>({
    queryKey:
      driverId && date
        ? shiftReconciliationKeys.record(driverId, date)
        : shiftReconciliationKeys.record('', ''),
    queryFn: () => getShiftReconciliationRecordAction(driverId!, date!),
    enabled,
    initialData: options?.initialData,
    staleTime: options?.initialData !== undefined ? 30_000 : 0
  });
}
