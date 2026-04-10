'use client';

import { useQuery } from '@tanstack/react-query';
import { referenceKeys } from '@/query/keys';
import { RechnungsempfaengerService } from '../api/rechnungsempfaenger.service';

/** Active recipients for Selects in Kostenträger / invoice builder. */
export function useRechnungsempfaengerOptions() {
  return useQuery({
    queryKey: referenceKeys.rechnungsempfaenger(),
    queryFn: () => RechnungsempfaengerService.listActive(),
    staleTime: 60_000
  });
}
