'use client';

import { useQuery } from '@tanstack/react-query';

import { fetchTripInvoiceStatuses } from '@/features/trips/api/trips.service';
import { TRIP_REFERENCE_STALE_TIME_MS } from '@/features/trips/hooks/use-trip-reference-queries';
import { createClient } from '@/lib/supabase/client';
import { tripKeys } from '@/query/keys';

// Client-side query for invoice status badges on the Fahrten list.
// Runs after the main RSC trip list renders, keyed by visible trip IDs.
// staleTime matches trip reference data (10 min) — invoice status does not need to
// be fresher than the trip list for this screen.
export function useTripInvoiceStatuses(tripIds: string[]) {
  return useQuery({
    queryKey: tripKeys.invoiceStatuses(tripIds),
    queryFn: async () => {
      const supabase = createClient();
      return fetchTripInvoiceStatuses(tripIds, supabase);
    },
    enabled: tripIds.length > 0,
    staleTime: TRIP_REFERENCE_STALE_TIME_MS
  });
}
