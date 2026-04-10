import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';

export interface PayerCombination {
  payer_id: string;
  billing_variant_id: string | null;
  billing_variant_name: string | null;
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
          .select(
            'payer_id, billing_variant_id, billing_variant:billing_variants(name)'
          )
          .eq('client_id', clientId),
        supabase
          .from('recurring_rules')
          .select(
            'payer_id, billing_variant_id, billing_variant:billing_variants(name)'
          )
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
          // Important: per_client “Abrechnung” combos are stored at Unterart (billing_variant_id) level.
          // Previous bug: this was returned in a field named `billing_type_id`, which downstream
          // code interpreted as a billing_types.id (family) and then returned zero trips.
          result.push({
            payer_id: t.payer_id,
            billing_variant_id: t.billing_variant_id,
            billing_variant_name:
              t.billing_variant && typeof t.billing_variant === 'object'
                ? // PostgREST nested select object: { name: string | null }
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ((t.billing_variant as any).name ?? null)
                : null
          });
        }
      });

      return result;
    },
    enabled: !!clientId,
    staleTime: 5 * 60 * 1000 // 5 minutes
  });
}
