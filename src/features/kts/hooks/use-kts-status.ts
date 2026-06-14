'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  clearKtsMistake,
  createKtsHandover,
  markKtsChecked,
  markKtsFehlerhaft,
  receiveKtsCorrection,
  sendKtsCorrection,
  updateKtsPatientId
} from '@/features/kts/kts.service';
import { ktsKpiKey } from '@/features/kts/hooks/use-kts-kpis';
import { fetchKtsCompanyId } from '@/features/kts/lib/fetch-kts-company-id';
import { useOptionalTripsRscRefresh } from '@/features/trips/providers';
import { createClient } from '@/lib/supabase/client';
import { tripKeys } from '@/query/keys';

function useKtsMutationSideEffects() {
  const queryClient = useQueryClient();
  const rscRefresh = useOptionalTripsRscRefresh();

  const onKtsWriteSuccess = async (tripId: string) => {
    void queryClient.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
    void queryClient.invalidateQueries({ queryKey: tripKeys.all });
    // why: stat cards use a dedicated key — refetch counts without waiting for full list RSC.
    void queryClient.invalidateQueries({ queryKey: ktsKpiKey });
    if (rscRefresh) {
      await rscRefresh.refreshTripsPage();
    }
  };

  const onKtsBatchWriteSuccess = async (tripIds: string[]) => {
    for (const tripId of tripIds) {
      void queryClient.invalidateQueries({ queryKey: tripKeys.detail(tripId) });
    }
    void queryClient.invalidateQueries({ queryKey: tripKeys.all });
    void queryClient.invalidateQueries({ queryKey: ktsKpiKey });
    if (rscRefresh) {
      await rscRefresh.refreshTripsPage();
    }
  };

  return { onKtsWriteSuccess, onKtsBatchWriteSuccess, queryClient };
}

export function useMarkKtsCheckedMutation() {
  const { onKtsWriteSuccess } = useKtsMutationSideEffects();

  return useMutation({
    mutationFn: ({ tripId }: { tripId: string }) => markKtsChecked(tripId),
    onSuccess: async (_data, { tripId }) => {
      await onKtsWriteSuccess(tripId);
    }
  });
}

export function useUpdateKtsPatientIdMutation() {
  const { onKtsWriteSuccess } = useKtsMutationSideEffects();

  return useMutation({
    mutationFn: ({
      tripId,
      patientId
    }: {
      tripId: string;
      patientId: string | null;
    }) => updateKtsPatientId(tripId, patientId),
    onSuccess: async (_data, { tripId }) => {
      await onKtsWriteSuccess(tripId);
    }
  });
}

export function useMarkKtsFehlerhaftMutation() {
  const { onKtsWriteSuccess } = useKtsMutationSideEffects();

  return useMutation({
    mutationFn: ({
      tripId,
      beschreibung
    }: {
      tripId: string;
      beschreibung: string;
    }) => markKtsFehlerhaft(tripId, beschreibung),
    onSuccess: async (_data, { tripId }) => {
      await onKtsWriteSuccess(tripId);
    }
  });
}

export function useClearKtsMistakeMutation() {
  const { onKtsWriteSuccess } = useKtsMutationSideEffects();

  return useMutation({
    mutationFn: ({ tripId }: { tripId: string }) => clearKtsMistake(tripId),
    onSuccess: async (_data, { tripId }) => {
      await onKtsWriteSuccess(tripId);
    }
  });
}

export function useSendKtsCorrectionMutation() {
  const { onKtsWriteSuccess, queryClient } = useKtsMutationSideEffects();

  return useMutation({
    mutationFn: async (payload: Parameters<typeof sendKtsCorrection>[1]) => {
      const supabase = createClient();
      return sendKtsCorrection(supabase, payload);
    },
    onSuccess: async (_data, payload) => {
      await onKtsWriteSuccess(payload.tripId);
      void queryClient.invalidateQueries({
        queryKey: tripKeys.ktsCorrections(payload.tripId)
      });
    }
  });
}

export function useReceiveKtsCorrectionMutation() {
  const { onKtsWriteSuccess, queryClient } = useKtsMutationSideEffects();

  return useMutation({
    mutationFn: async (payload: Parameters<typeof receiveKtsCorrection>[1]) => {
      const supabase = createClient();
      return receiveKtsCorrection(supabase, payload);
    },
    onSuccess: async (_data, payload) => {
      await onKtsWriteSuccess(payload.tripId);
      void queryClient.invalidateQueries({
        queryKey: tripKeys.ktsCorrections(payload.tripId)
      });
    }
  });
}

export function useCreateKtsHandoverMutation() {
  const { onKtsBatchWriteSuccess } = useKtsMutationSideEffects();

  return useMutation({
    mutationFn: async ({ tripIds }: { tripIds: string[] }) => {
      const companyId = await fetchKtsCompanyId();
      if (!companyId) {
        throw new Error('Unternehmen konnte nicht ermittelt werden.');
      }
      const supabase = createClient();
      return createKtsHandover(supabase, { companyId, tripIds });
    },
    onSuccess: async (_data, { tripIds }) => {
      await onKtsBatchWriteSuccess(tripIds);
    }
  });
}
