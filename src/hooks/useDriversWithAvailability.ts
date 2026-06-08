'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DriverDayContext } from '@/lib/driver-availability';
import { getActiveDriversDayContextAction } from '@/lib/driver-availability.actions';
import { driverAvailabilityKeys } from '@/query/keys/driver-availability';

const STALE_MS = 2 * 60 * 1000;

export function useDriversWithAvailability(dateYmd: string | null) {
  const enabled = Boolean(dateYmd);

  const query = useQuery({
    queryKey: driverAvailabilityKeys.driversDay(dateYmd ?? ''),
    queryFn: () => getActiveDriversDayContextAction(dateYmd!),
    enabled,
    staleTime: STALE_MS,
    retry: false
  });

  const dataMap = useMemo((): Map<string, DriverDayContext> => {
    if (!query.data || query.isError) return new Map();
    return new Map(query.data.map((ctx) => [ctx.driverId, ctx]));
  }, [query.data, query.isError]);

  return {
    ...query,
    dataMap
  };
}
