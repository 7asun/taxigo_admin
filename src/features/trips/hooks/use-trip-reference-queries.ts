'use client';

import { useQuery } from '@tanstack/react-query';
import { referenceKeys } from '@/query/keys';
import {
  fetchActiveDrivers,
  fetchBillingVariantsForPayer,
  fetchPayers
} from '@/features/trips/api/trip-reference-data';

/**
 * Long-lived cache for small reference lists. Dispatchers rarely add/remove drivers;
 * overrides default `staleTime` so remounting many table cells does not refetch constantly.
 */
export const TRIP_REFERENCE_STALE_TIME_MS = 10 * 60 * 1000;

/**
 * Active drivers — shared across `DriverSelectCell` rows, filters bar, Kanban, trip form.
 */
export function useDriversQuery() {
  return useQuery({
    queryKey: referenceKeys.drivers(),
    queryFn: fetchActiveDrivers,
    staleTime: TRIP_REFERENCE_STALE_TIME_MS
  });
}

export function usePayersQuery() {
  return useQuery({
    queryKey: referenceKeys.payers(),
    queryFn: fetchPayers,
    staleTime: TRIP_REFERENCE_STALE_TIME_MS
  });
}

/**
 * Billing variants for one payer. Disabled when `payerId` is missing or the URL sentinel `'all'`.
 */
export function useBillingVariantsForPayerQuery(
  payerId: string | null | undefined
) {
  const isRealPayer =
    typeof payerId === 'string' && payerId.length > 0 && payerId !== 'all';

  return useQuery({
    queryKey: referenceKeys.billingVariants(isRealPayer ? payerId : '__none__'),
    queryFn: () => fetchBillingVariantsForPayer(payerId!),
    enabled: isRealPayer,
    staleTime: TRIP_REFERENCE_STALE_TIME_MS
  });
}
