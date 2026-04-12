'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient
} from '@tanstack/react-query';
import { referenceKeys } from '@/query/keys';
import {
  createPricingRule,
  deletePricingRule,
  listAllPricingRules,
  pricingRulesErrorMessage,
  updatePricingRule,
  type BillingPricingRuleRow,
  type BillingPricingRuleWithContext,
  type CreatePricingRulePayload
} from '@/features/payers/api/billing-pricing-rules.api';

/** Shared with pages whose dialogs call the API directly (e.g. `PricingRuleDialog`). */
export function invalidatePricingRuleCaches(qc: QueryClient): void {
  // Global catalog + every per-payer `useBillingPricingRules` cache: Kostenträger sheets open
  // in another tab (or the same tab) must refetch so pricing rows never stay stale after edits here.
  void qc.invalidateQueries({
    queryKey: referenceKeys.allBillingPricingRules()
  });
  void qc.invalidateQueries({ queryKey: ['reference', 'billingPricingRules'] });
  void qc.invalidateQueries({ queryKey: ['reference', 'clientPriceTags'] });
}

export function useAllPricingRules() {
  const qc = useQueryClient();

  const query = useQuery<BillingPricingRuleWithContext[]>({
    queryKey: referenceKeys.allBillingPricingRules(),
    queryFn: listAllPricingRules,
    staleTime: 30_000
  });

  const createM = useMutation({
    mutationFn: (payload: CreatePricingRulePayload) =>
      createPricingRule(payload),
    onSuccess: () => invalidatePricingRuleCaches(qc)
  });

  const updateM = useMutation({
    mutationFn: (args: {
      id: string;
      strategy?: BillingPricingRuleRow['strategy'];
      config?: unknown;
      is_active?: boolean;
    }) => updatePricingRule(args.id, args),
    onSuccess: () => invalidatePricingRuleCaches(qc)
  });

  const deleteM = useMutation({
    mutationFn: (ruleId: string) => deletePricingRule(ruleId),
    onSuccess: () => invalidatePricingRuleCaches(qc)
  });

  return {
    ...query,
    createRule: createM.mutateAsync,
    updateRule: updateM.mutateAsync,
    deleteRule: deleteM.mutateAsync,
    isSaving: createM.isPending || updateM.isPending,
    isDeleting: deleteM.isPending,
    pricingRulesErrorMessage
  };
}
