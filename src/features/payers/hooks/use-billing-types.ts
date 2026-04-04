import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PayersService } from '../api/payers.service';
import type {
  BillingFamilyWithVariants,
  BillingTypeBehavior
} from '../types/payer.types';
import { PAYERS_QUERY_KEY } from './use-payers';
import { referenceKeys } from '@/query/keys';

/** Kostenträger sheet + local cache; distinct from trip form reference cache. */
export const PAYER_BILLING_TREE_QUERY_KEY = 'payer_billing_tree';

export function useBillingTypes(payerId: string | undefined | null) {
  const queryClient = useQueryClient();

  const query = useQuery<BillingFamilyWithVariants[]>({
    queryKey: [PAYER_BILLING_TREE_QUERY_KEY, payerId],
    queryFn: () =>
      PayersService.getBillingFamiliesWithVariants(payerId as string),
    enabled: !!payerId,
    staleTime: 1000 * 60 * 5
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({
      queryKey: [PAYER_BILLING_TREE_QUERY_KEY, payerId]
    });
    queryClient.invalidateQueries({ queryKey: [PAYERS_QUERY_KEY] });
    if (payerId) {
      queryClient.invalidateQueries({
        queryKey: referenceKeys.billingVariants(payerId)
      });
    }
  };

  const createFamilyMutation = useMutation({
    mutationFn: (args: {
      familyName: string;
      color: string;
      initialVariantName?: string;
      initialVariantCode?: string;
    }) =>
      PayersService.createBillingFamilyWithDefaultVariant(
        payerId as string,
        args.familyName,
        args.color,
        {
          initialVariantName: args.initialVariantName,
          initialVariantCode: args.initialVariantCode
        }
      ),
    onSuccess: invalidateAll
  });

  const createVariantMutation = useMutation({
    mutationFn: (args: {
      familyId: string;
      name: string;
      /** Omit to auto-generate from Unterart + Familie (unique in family). */
      code?: string;
      sortOrder?: number;
      kts_default?: boolean | null;
      no_invoice_required_default?: boolean | null;
    }) =>
      PayersService.createBillingVariant(
        args.familyId,
        args.name,
        args.code,
        args.sortOrder,
        args.kts_default,
        args.no_invoice_required_default
      ),
    onSuccess: invalidateAll
  });

  const deleteVariantMutation = useMutation({
    mutationFn: (id: string) => PayersService.deleteBillingVariant(id),
    onSuccess: invalidateAll
  });

  const deleteFamilyMutation = useMutation({
    mutationFn: (id: string) => PayersService.deleteBillingFamily(id),
    onSuccess: invalidateAll
  });

  const updateBehaviorMutation = useMutation({
    mutationFn: ({
      familyId,
      behavior
    }: {
      familyId: string;
      behavior: BillingTypeBehavior;
    }) => PayersService.updateBillingFamilyBehavior(familyId, behavior),
    onSuccess: invalidateAll
  });

  const updateFamilyMutation = useMutation({
    mutationFn: (args: { familyId: string; name: string; color: string }) =>
      PayersService.updateBillingFamily(args.familyId, args.name, args.color),
    onSuccess: invalidateAll
  });

  const updateVariantMutation = useMutation({
    mutationFn: (args: {
      variantId: string;
      name: string;
      code: string;
      kts_default: boolean | null;
      no_invoice_required_default?: boolean | null;
    }) =>
      PayersService.updateBillingVariant(
        args.variantId,
        args.name,
        args.code,
        args.kts_default,
        args.no_invoice_required_default
      ),
    onSuccess: invalidateAll
  });

  return {
    ...query,
    createBillingFamily: createFamilyMutation.mutateAsync,
    isCreatingFamily: createFamilyMutation.isPending,
    createBillingVariant: createVariantMutation.mutateAsync,
    isCreatingVariant: createVariantMutation.isPending,
    deleteBillingVariant: deleteVariantMutation.mutateAsync,
    deleteBillingFamily: deleteFamilyMutation.mutateAsync,
    isDeleting:
      deleteVariantMutation.isPending || deleteFamilyMutation.isPending,
    updateFamilyBehavior: updateBehaviorMutation.mutateAsync,
    isUpdatingBehavior: updateBehaviorMutation.isPending,
    updateBillingFamily: updateFamilyMutation.mutateAsync,
    isUpdatingFamily: updateFamilyMutation.isPending,
    updateBillingVariant: updateVariantMutation.mutateAsync,
    isUpdatingVariant: updateVariantMutation.isPending
  };
}
