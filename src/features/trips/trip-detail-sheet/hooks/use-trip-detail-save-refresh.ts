'use client';

/**
 * After mutating a trip from the detail sheet, keep **Fahrten RSC** and **TanStack Query**
 * in sync — same contract as `useTripCancellation` (see `use-trip-cancellation.ts`).
 *
 * @see docs/trips-page-rsc-refresh.md
 */
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useOptionalTripsRscRefresh } from '@/features/trips/providers';
import { tripKeys } from '@/query/keys';

export function useTripDetailSaveRefresh() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const optionalRscRefresh = useOptionalTripsRscRefresh();

  const refreshAfterTripSave = useCallback(async () => {
    if (optionalRscRefresh) {
      await optionalRscRefresh.refreshTripsPage();
    } else {
      await router.refresh();
      await queryClient.invalidateQueries({ queryKey: tripKeys.all });
    }
  }, [optionalRscRefresh, queryClient, router]);

  return { refreshAfterTripSave };
}
