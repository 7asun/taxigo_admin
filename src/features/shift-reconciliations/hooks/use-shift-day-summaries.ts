'use client';

import { useQuery } from '@tanstack/react-query';
import { getShiftDaySummariesAction } from '../actions';
import { shiftReconciliationKeys } from '../lib/query-keys';
import type { ShiftDaySummary } from '../types';

const STALE_MS = 5 * 60 * 1000;

type UseShiftDaySummariesOpts = {
  initialData?: ShiftDaySummary[];
};

export function useShiftDaySummaries(
  driverId: string | null,
  options?: UseShiftDaySummariesOpts
) {
  const enabled = Boolean(driverId);

  return useQuery<ShiftDaySummary[]>({
    queryKey: shiftReconciliationKeys.summaries(driverId ?? '__none__'),
    queryFn: () => getShiftDaySummariesAction(driverId!),
    enabled,
    staleTime: STALE_MS,
    initialData: options?.initialData
  });
}
