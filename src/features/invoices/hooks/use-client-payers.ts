import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

export interface PayerCombination {
  payer_id: string;
  billing_type_id: string | null;
}

export function useClientPayers(clientId: string | null) {
  return useQuery({
    queryKey: ['client_payers', clientId],
    queryFn: async (): Promise<PayerCombination[]> => {
      if (!clientId) return [];
      const supabase = createClient();

      const [tripsRes, rulesRes] = await Promise.all([
        supabase
          .from('trips')
          .select('payer_id, billing_variant_id')
          .eq('client_id', clientId),
        supabase
          .from('recurring_rules')
          .select('payer_id, billing_variant_id')
          .eq('client_id', clientId)
      ]);

      if (tripsRes.error) throw tripsRes.error;
      if (rulesRes.error) throw rulesRes.error;

      const combinedData = [...(tripsRes.data || []), ...(rulesRes.data || [])];

      const combinations = new Set<string>();
      const result: PayerCombination[] = [];

      combinedData.forEach((t) => {
        if (!t.payer_id) return;
        const key = `${t.payer_id}_${t.billing_variant_id || 'none'}`;
        if (!combinations.has(key)) {
          combinations.add(key);
          result.push({
            payer_id: t.payer_id,
            billing_type_id: t.billing_variant_id
          });
        }
      });

      return result;
    },
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000 // 5 minutes
  });
}
