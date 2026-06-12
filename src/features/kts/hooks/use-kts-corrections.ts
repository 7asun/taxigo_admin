'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  closeKtsCorrection,
  fetchTripCorrections,
  insertKtsCorrection
} from '@/features/kts/kts.service';
import { createClient } from '@/lib/supabase/client';
import { tripKeys } from '@/query/keys';

export type { KtsCorrection } from '@/features/kts/kts.service';

export function useTripCorrections(tripId: string | undefined) {
  return useQuery({
    queryKey: tripKeys.ktsCorrections(tripId!),
    queryFn: async () => {
      const supabase = createClient();
      return fetchTripCorrections(supabase, tripId!);
    },
    enabled: !!tripId?.trim(),
    staleTime: 0
  });
}

export function useInsertKtsCorrectionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Parameters<typeof insertKtsCorrection>[1]) => {
      const supabase = createClient();
      return insertKtsCorrection(supabase, payload);
    },
    onSuccess: (_data, payload) => {
      void queryClient.invalidateQueries({
        queryKey: tripKeys.ktsCorrections(payload.tripId)
      });
    }
  });
}

export function useCloseKtsCorrectionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      correctionId,
      receivedAt
    }: {
      correctionId: string;
      tripId: string;
      receivedAt: Date;
    }) => {
      const supabase = createClient();
      return closeKtsCorrection(supabase, correctionId, receivedAt);
    },
    onSuccess: (_data, { tripId }) => {
      void queryClient.invalidateQueries({
        queryKey: tripKeys.ktsCorrections(tripId)
      });
    }
  });
}
