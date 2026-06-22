'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ktsAbrechnungKpiKey } from '@/features/kts/hooks/use-kts-abrechnung-kpis';
import { ktsKpiKey } from '@/features/kts/hooks/use-kts-kpis';
import {
  ktsAbrechnungKey,
  markBelegnummerAbgerechnet,
  markBelegnummerBezahlt,
  markBelegnummerRuecklaufer,
  type MarkBelegnummerResult
} from '@/features/kts/kts.service';
import { fetchKtsCompanyId } from '@/features/kts/lib/fetch-kts-company-id';
import { useOptionalTripsRscRefresh } from '@/features/trips/providers';
import { createClient } from '@/lib/supabase/client';
import { tripKeys } from '@/query/keys';

function useAbrechnungMutationSideEffects() {
  const queryClient = useQueryClient();
  const rscRefresh = useOptionalTripsRscRefresh();

  const onSuccess = async () => {
    void queryClient.invalidateQueries({ queryKey: tripKeys.all });
    void queryClient.invalidateQueries({ queryKey: ktsKpiKey });
    void queryClient.invalidateQueries({ queryKey: ktsAbrechnungKey });
    void queryClient.invalidateQueries({ queryKey: ktsAbrechnungKpiKey });
    if (rscRefresh) {
      await rscRefresh.refreshTripsPage();
    }
  };

  return { onSuccess };
}

async function resolveCompanyId(): Promise<string> {
  const companyId = await fetchKtsCompanyId();
  if (!companyId) {
    throw new Error('Unternehmen konnte nicht ermittelt werden.');
  }
  return companyId;
}

export function useMarkBelegnummerBezahltMutation() {
  const { onSuccess } = useAbrechnungMutationSideEffects();

  return useMutation({
    mutationFn: async ({
      belegnummer
    }: {
      belegnummer: string;
    }): Promise<MarkBelegnummerResult> => {
      const companyId = await resolveCompanyId();
      const supabase = createClient();
      const result = await markBelegnummerBezahlt(supabase, {
        companyId,
        belegnummer
      });

      if (!result.success && result.error === 'ruecklaufer_open') {
        return result;
      }

      if (!result.success) {
        throw new Error('Beleg konnte nicht als bezahlt markiert werden.');
      }

      return result;
    },
    onSuccess: async (result) => {
      if (result.success) {
        toast.success('Beleg als bezahlt markiert.');
        await onSuccess();
      }
    },
    onError: (error: Error) => {
      toast.error(error.message);
    }
  });
}

export function useMarkBelegnummerRuecklauferMutation() {
  const { onSuccess } = useAbrechnungMutationSideEffects();

  return useMutation({
    mutationFn: async ({
      belegnummer,
      reason
    }: {
      belegnummer: string;
      reason?: string | null;
    }) => {
      const companyId = await resolveCompanyId();
      const supabase = createClient();
      const result = await markBelegnummerRuecklaufer(supabase, {
        companyId,
        belegnummer,
        reason
      });

      if (!result.success) {
        throw new Error('Rückläufer konnte nicht gemeldet werden.');
      }

      return result;
    },
    onSuccess: async () => {
      toast.success('Beleg als Rückläufer markiert.');
      await onSuccess();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    }
  });
}

export function useMarkBelegnummerAbgerechnetMutation() {
  const { onSuccess } = useAbrechnungMutationSideEffects();

  return useMutation({
    mutationFn: async ({ belegnummer }: { belegnummer: string }) => {
      const companyId = await resolveCompanyId();
      const supabase = createClient();
      const result = await markBelegnummerAbgerechnet(supabase, {
        companyId,
        belegnummer
      });

      if (!result.success) {
        throw new Error('Beleg konnte nicht zurückgesetzt werden.');
      }

      return result;
    },
    onSuccess: async () => {
      toast.success('Beleg wieder auf Abgerechnet gesetzt.');
      await onSuccess();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    }
  });
}
