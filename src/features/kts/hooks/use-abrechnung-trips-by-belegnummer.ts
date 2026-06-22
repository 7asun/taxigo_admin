'use client';

import { useQuery } from '@tanstack/react-query';

import { ktsAbrechnungKey } from '@/features/kts/kts.service';
import { fetchKtsCompanyId } from '@/features/kts/lib/fetch-kts-company-id';
import type { AbrechnungTripRow } from '@/features/kts/types/kts-abrechnung-group';
import { createClient } from '@/lib/supabase/client';

const ABRECHNUNG_TRIP_SELECT = `
  id,
  scheduled_at,
  client_name,
  kts_patient_id,
  kts_invoice_amount,
  kts_eigenanteil,
  kts_status,
  kts_ruecklaufer_reason
`;

/**
 * why: expand row loads trips client-side — RSC group query avoids embedding all trips per Beleg.
 */
export function useAbrechnungTripsByBelegnummer(belegnummer: string | null) {
  return useQuery({
    queryKey: [...ktsAbrechnungKey, 'trips', belegnummer],
    enabled: Boolean(belegnummer?.trim()),
    queryFn: async (): Promise<AbrechnungTripRow[]> => {
      const trimmed = belegnummer?.trim();
      if (!trimmed) return [];

      const companyId = await fetchKtsCompanyId();
      if (!companyId) {
        throw new Error('Unternehmen konnte nicht ermittelt werden.');
      }

      const supabase = createClient();
      const { data, error } = await supabase
        .from('trips')
        .select(ABRECHNUNG_TRIP_SELECT)
        .eq('company_id', companyId)
        .eq('kts_document_applies', true)
        .eq('kts_belegnummer', trimmed)
        .in('kts_status', ['abgerechnet', 'ruecklaufer', 'bezahlt'])
        .order('scheduled_at', { ascending: true });

      if (error) throw error;
      return (data ?? []) as AbrechnungTripRow[];
    }
  });
}
