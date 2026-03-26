import type { BillingVariantOption } from '@/features/trips/types/trip-form-reference.types';

/**
 * Behavior JSON lives on the billing **family**; every flattened variant row repeats it.
 * Use the selected Unterart when set; otherwise any variant under the effective family
 * so defaults / return policy apply before the user picks Unterart.
 */
export function resolveBillingBehaviorSourceVariant(options: {
  billingTypes: BillingVariantOption[];
  billingVariantId: string | undefined;
  /** From family dropdown, or the only family’s id when there is just one. */
  effectiveFamilyId: string;
}): BillingVariantOption | undefined {
  const { billingTypes, billingVariantId, effectiveFamilyId } = options;

  if (billingVariantId) {
    return billingTypes.find((b) => b.id === billingVariantId);
  }

  if (!effectiveFamilyId) return undefined;

  const inFamily = billingTypes.filter(
    (b) => b.billing_type_id === effectiveFamilyId
  );
  if (inFamily.length === 0) return undefined;

  return [...inFamily].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(b.name);
  })[0];
}
