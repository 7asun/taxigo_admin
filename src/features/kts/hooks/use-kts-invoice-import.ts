'use client';

/**
 * why: CSV invoice import is a distinct domain from status transitions — separate hook file
 * keeps handover/correction mutations isolated from accountant batch import.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ktsAbrechnungKpiKey } from '@/features/kts/hooks/use-kts-abrechnung-kpis';
import { ktsKpiKey } from '@/features/kts/hooks/use-kts-kpis';
import {
  applyKtsInvoiceImport,
  fetchKtsCandidateTrips,
  ktsAbrechnungKey,
  type ApplyKtsInvoiceImportPayload
} from '@/features/kts/kts.service';
import { fetchKtsCompanyId } from '@/features/kts/lib/fetch-kts-company-id';
import { useOptionalTripsRscRefresh } from '@/features/trips/providers';
import { createClient } from '@/lib/supabase/client';
import { tripKeys } from '@/query/keys';

export const ktsImportCandidatesKey = ['kts', 'import-candidates'] as const;

/**
 * why: candidate fetch is lazy — only after file select, not when admin opens and closes
 * the dialog without uploading (avoids loading full KTS backlog unnecessarily).
 */
export function useFetchKtsCandidateTrips(enabled: boolean) {
  return useQuery({
    queryKey: [...ktsImportCandidatesKey, 'company'],
    queryFn: async () => {
      const companyId = await fetchKtsCompanyId();
      if (!companyId) {
        throw new Error('Unternehmen konnte nicht ermittelt werden.');
      }
      const supabase = createClient();
      return fetchKtsCandidateTrips(supabase, companyId);
    },
    enabled,
    staleTime: 0
  });
}

export function useApplyKtsInvoiceImportMutation() {
  const queryClient = useQueryClient();
  const rscRefresh = useOptionalTripsRscRefresh();

  return useMutation({
    mutationFn: async (payload: ApplyKtsInvoiceImportPayload) => {
      const supabase = createClient();
      return applyKtsInvoiceImport(supabase, payload);
    },
    onSuccess: async (_data, payload) => {
      for (const row of payload.rows) {
        void queryClient.invalidateQueries({
          queryKey: tripKeys.detail(row.tripId)
        });
      }
      void queryClient.invalidateQueries({ queryKey: tripKeys.all });
      void queryClient.invalidateQueries({ queryKey: ktsKpiKey });
      void queryClient.invalidateQueries({ queryKey: ktsAbrechnungKey });
      void queryClient.invalidateQueries({ queryKey: ktsAbrechnungKpiKey });
      if (rscRefresh) {
        await rscRefresh.refreshTripsPage();
      }
    }
  });
}
