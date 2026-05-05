/**
 * Pure assembly of Supabase trip-fetch params from invoice builder Step 2.
 * Kept out of the client hook so tests and resolvers can share one definition.
 */

import {
  normalizeTripsForBuilderTypeIdsForQueryKey,
  normalizeTripsForBuilderVariantIdsForQueryKey
} from '@/query/keys';
import type { FetchTripsForBuilderParams } from '@/features/invoices/api/invoice-line-items.api';
import type { InvoiceBuilderFormValues } from '@/features/invoices/types/invoice.types';

export type TripsBuilderStep2Input = Pick<
  InvoiceBuilderFormValues,
  | 'mode'
  | 'payer_id'
  | 'billing_type_id'
  | 'billing_type_ids'
  | 'billing_variant_id'
  | 'billing_variant_ids'
  | 'period_from'
  | 'period_to'
  | 'client_id'
>;

/**
 * Assembles trip-fetch params from Step 2 state for live + cancelled queries.
 */
export function tripsBuilderParamsFromStep2(
  step2: TripsBuilderStep2Input
): FetchTripsForBuilderParams {
  let billing_type_id = step2.billing_type_id;
  let billing_variant_id =
    step2.mode === 'per_client' ? step2.billing_variant_id : null;
  // why: monthly / single_trip scope uses billing_variant_ids + type expansion only; single-Unterart header path is per_client.
  let billing_variant_ids = step2.billing_variant_ids?.length
    ? step2.billing_variant_ids
    : null;

  const billing_type_ids =
    step2.mode === 'per_client'
      ? null
      : normalizeTripsForBuilderTypeIdsForQueryKey(step2.billing_type_ids);

  if (step2.mode === 'per_client') {
    // why: per_client uses single `billing_variant_id` only; subset array is monthly-only.
    billing_variant_ids = null;
  } else {
    // why: Unterarten subset only valid with exactly one Abrechnungsart in scope; invalid monthly state must not reach the resolver.
    const len = billing_type_ids?.length ?? 0;
    if (len !== 1) {
      billing_variant_ids = null;
    }
  }

  billing_variant_ids =
    normalizeTripsForBuilderVariantIdsForQueryKey(billing_variant_ids);

  return {
    payer_id: step2.payer_id,
    billing_type_id,
    billing_type_ids,
    billing_variant_id,
    billing_variant_ids,
    period_from: step2.period_from,
    period_to: step2.period_to,
    client_id: step2.client_id
  };
}
