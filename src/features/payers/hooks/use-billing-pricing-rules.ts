'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { referenceKeys } from '@/query/keys';
import {
  createPricingRule,
  deletePricingRule,
  listPricingRulesForPayer,
  pricingRulesErrorMessage,
  updatePricingRule,
  type BillingPricingRuleRow,
  type CreatePricingRulePayload
} from '@/features/payers/api/billing-pricing-rules.api';

export function useBillingPricingRules(payerId: string | undefined | null) {
  const qc = useQueryClient();
  const id = payerId ?? '';

  const query = useQuery({
    queryKey: referenceKeys.billingPricingRules(id),
    queryFn: () => listPricingRulesForPayer(id),
    enabled: !!payerId,
    staleTime: 30_000
  });

  const invalidate = () => {
    void qc.invalidateQueries({
      queryKey: referenceKeys.billingPricingRules(id)
    });
  };

  const createM = useMutation({
    mutationFn: (payload: CreatePricingRulePayload) =>
      createPricingRule(payload),
    onSuccess: invalidate
  });

  const updateM = useMutation({
    mutationFn: (args: {
      id: string;
      strategy?: BillingPricingRuleRow['strategy'];
      config?: unknown;
      is_active?: boolean;
    }) => updatePricingRule(args.id, args),
    onSuccess: invalidate
  });

  const deleteM = useMutation({
    mutationFn: (ruleId: string) => deletePricingRule(ruleId),
    onSuccess: invalidate
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
