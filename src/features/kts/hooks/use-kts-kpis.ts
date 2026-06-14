'use client';

import { useQuery } from '@tanstack/react-query';

import { createClient } from '@/lib/supabase/client';
import { fetchKtsCompanyId } from '@/features/kts/lib/fetch-kts-company-id';

export const ktsKpiKey = ['kts', 'kpis'] as const;

export interface KtsQueueKpis {
  gesamt: number;
  ungeprueft: number;
  fehler_aktiv: number;
  ueberfaellig: number;
}

const EMPTY_KPIS: KtsQueueKpis = {
  gesamt: 0,
  ungeprueft: 0,
  fehler_aktiv: 0,
  ueberfaellig: 0
};

/**
 * Client React Query hook for KTS queue KPI counts.
 * Invalidated by kts transition mutations via ktsKpiKey (separate from trip list RSC).
 */
export function useKtsKpis() {
  return useQuery({
    queryKey: [...ktsKpiKey, 'company'],
    queryFn: async (): Promise<KtsQueueKpis> => {
      const supabase = createClient();
      const companyId = await fetchKtsCompanyId();
      if (!companyId) return EMPTY_KPIS;

      const { data, error } = await supabase.rpc('get_kts_queue_kpis', {
        p_company_id: companyId
      });
      if (error) throw error;

      const row = data?.[0];
      if (!row) return EMPTY_KPIS;

      return {
        gesamt: Number(row.gesamt ?? 0),
        ungeprueft: Number(row.ungeprueft ?? 0),
        fehler_aktiv: Number(row.fehler_aktiv ?? 0),
        ueberfaellig: Number(row.ueberfaellig ?? 0)
      };
    }
  });
}
