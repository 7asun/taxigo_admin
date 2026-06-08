'use client';

import { useQuery } from '@tanstack/react-query';
import { getDriverDayContextAction } from '@/lib/driver-availability.actions';
import { driverAvailabilityKeys } from '@/query/keys/driver-availability';

const STALE_MS = 2 * 60 * 1000;

export function useDriverAvailability(
  driverId: string | null,
  dateYmd: string | null
) {
  const enabled = Boolean(driverId && dateYmd);

  return useQuery({
    queryKey: driverAvailabilityKeys.day(driverId ?? '', dateYmd ?? ''),
    queryFn: () => getDriverDayContextAction(driverId!, dateYmd!),
    enabled,
    staleTime: STALE_MS
  });
}
