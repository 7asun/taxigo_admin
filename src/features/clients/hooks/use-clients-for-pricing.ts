'use client';

/**
 * React Query hooks for client price tag management on the Preisregeln page.
 *
 * useClientsForPricing   → reference list (stale 60s); used in ClientPriceSearch
 *                          and in the pricing-rules-page client rows.
 * useSetClientPriceTag   → mutation; invalidates referenceKeys.clients() on success
 *                          so both the dialog and the page table stay in sync.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { referenceKeys } from '@/query/keys';
import {
  listClientsForPricing,
  setClientPriceTag
} from '@/features/clients/api/clients-pricing.api';

export function useClientsForPricing() {
  return useQuery({
    queryKey: referenceKeys.clients(),
    queryFn: listClientsForPricing,
    staleTime: 60_000
  });
}

export function useSetClientPriceTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      clientId,
      price
    }: {
      clientId: string;
      price: number | null;
    }) => setClientPriceTag(clientId, price),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: referenceKeys.clients() });
    }
  });
}
