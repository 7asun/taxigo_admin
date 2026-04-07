/**
 * Adapter from Spec C PriceResolution to legacy PriceResult for incremental migration.
 * Prefer resolveTripPrice from ./resolve-trip-price for new code.
 */
import type { TripForInvoice } from '../types/invoice.types';
import type { BillingPricingRuleLike } from '../types/pricing.types';

import { resolveTripPrice as resolveTripPricePure } from './resolve-trip-price';

export interface PriceResult {
  unitPrice: number | null;
  quantity: number;
  totalPrice: number | null;
  source: 'client_price_tag' | 'trip_price' | null;
}

function mapSource(src: string): 'client_price_tag' | 'trip_price' | null {
  if (src === 'client_price_tag') return 'client_price_tag';
  if (src === 'trip_price') return 'trip_price';
  return null;
}

/**
 * @param trip - trip row with client + price fields
 * @param taxRate - 0.07 or 0.19
 * @param rule - optional resolved billing_pricing_rules row
 */
export function resolveTripPrice(
  trip: Pick<
    TripForInvoice,
    | 'price'
    | 'driving_distance_km'
    | 'client'
    | 'kts_document_applies'
    | 'scheduled_at'
  >,
  taxRate: number,
  rule: BillingPricingRuleLike | null = null
): PriceResult {
  const pr = resolveTripPricePure(
    {
      kts_document_applies: trip.kts_document_applies === true,
      price: trip.price ?? null,
      driving_distance_km: trip.driving_distance_km ?? null,
      scheduled_at: trip.scheduled_at,
      client: trip.client
    },
    taxRate,
    rule
  );
  const unit = pr.unit_price_net;
  const qty = pr.quantity;
  const total =
    unit !== null && unit !== undefined
      ? Math.round(unit * qty * 100) / 100
      : null;
  return {
    unitPrice: unit,
    quantity: qty,
    totalPrice: total,
    source: mapSource(pr.source)
  };
}

export { resolveTripPricePure };
