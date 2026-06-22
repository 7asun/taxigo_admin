'use client';

import { useQuery } from '@tanstack/react-query';

import {
  fetchKtsAbrechnungKpis,
  type KtsAbrechnungKpis
} from '@/features/kts/kts.service';
import { fetchKtsCompanyId } from '@/features/kts/lib/fetch-kts-company-id';
import { createClient } from '@/lib/supabase/client';

export const ktsAbrechnungKpiKey = ['kts', 'abrechnung', 'kpis'] as const;

const EMPTY_KPIS: KtsAbrechnungKpis = {
  total_belege: 0,
  total_invoiced: 0,
  total_bezahlt: 0,
  total_offen: 0
};

/** Client React Query hook for Abrechnung tab KPI counts. */
export function useKtsAbrechnungKpis() {
  return useQuery({
    queryKey: [...ktsAbrechnungKpiKey, 'company'],
    queryFn: async (): Promise<KtsAbrechnungKpis> => {
      const supabase = createClient();
      const companyId = await fetchKtsCompanyId();
      if (!companyId) return EMPTY_KPIS;

      return fetchKtsAbrechnungKpis(supabase, companyId);
    }
  });
}
