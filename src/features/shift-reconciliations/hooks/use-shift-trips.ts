'use client';

import { useQuery } from '@tanstack/react-query';
import { getShiftTripsForDateAction } from '../actions';
import { shiftReconciliationKeys } from '../lib/query-keys';
import type { ShiftTrip } from '../types';

type UseShiftTripsOpts = { initialData?: ShiftTrip[]; enabled?: boolean };

export function useShiftTrips(
  driverId: string | null,
  date: string | null,
  options?: UseShiftTripsOpts
) {
  const canQuery = Boolean(driverId && date && date.length >= 10);
  const enabled = canQuery && (options?.enabled ?? true);

  return useQuery<ShiftTrip[]>({
    queryKey:
      driverId && date
        ? shiftReconciliationKeys.trips(driverId, date)
        : shiftReconciliationKeys.trips('', ''),
    queryFn: () => getShiftTripsForDateAction(driverId!, date!),
    enabled,
    initialData: options?.initialData,
    /** RSC prefill: avoid an immediate refetch on mount when server already loaded this range. */
    staleTime: options?.initialData !== undefined ? 30_000 : 0
  });
}
