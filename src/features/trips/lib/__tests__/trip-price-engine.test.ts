import { describe, expect, test } from 'bun:test';

import { computeTripPrice, shouldRecalculatePrice } from '../trip-price-engine';
import type {
  ComputeTripPriceInput,
  PricingContext
} from '../trip-price-engine';
import type { BillingPricingRuleLike } from '@/features/invoices/types/pricing.types';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function rule(
  partial: Partial<BillingPricingRuleLike> &
    Pick<BillingPricingRuleLike, 'strategy' | 'config'>
): BillingPricingRuleLike {
  return {
    id: 'r1',
    company_id: 'co1',
    payer_id: partial.payer_id ?? 'payer1',
    billing_type_id: partial.billing_type_id ?? null,
    billing_variant_id: partial.billing_variant_id ?? null,
    strategy: partial.strategy,
    config: partial.config,
    pricing_basis: partial.pricing_basis ?? 'net',
    is_active: partial.is_active ?? true,
    _price_gross: partial._price_gross
  };
}

const emptyCtx: PricingContext = {
  rules: [],
  clientPriceTags: [],
  clientPriceTag: null
};

const baseTrip = {
  payer_id: 'payer1' as string | null,
  billing_type_id: null as string | null,
  billing_variant_id: null as string | null,
  client_id: null as string | null,
  driving_distance_km: 15 as number | null,
  scheduled_at: '2026-06-15T10:00:00.000Z',
  kts_document_applies: false,
  net_price: null as number | null,
  base_net_price: null as number | null,
  manual_gross_price: null as number | null
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('computeTripPrice', () => {
  test('no payer_id → all price fields are null', () => {
    const result = computeTripPrice({ ...baseTrip, payer_id: null }, emptyCtx);
    expect(result.gross_price).toBeNull();
    expect(result.tax_rate).toBeNull();
    expect(result.base_net_price).toBeNull();
    expect(result.approach_fee_net).toBeNull();
  });

  test('KTS override → net=0, gross=0, tax_rate is set (not null)', () => {
    const ctx: PricingContext = {
      rules: [
        rule({
          strategy: 'tiered_km',
          config: { tiers: [{ from_km: 0, to_km: null, price_per_km: 2 }] }
        })
      ],
      clientPriceTags: [],
      clientPriceTag: null
    };
    const result = computeTripPrice(
      { ...baseTrip, kts_document_applies: true },
      ctx
    );
    expect(result.gross_price).toBe(0);
    expect(result.tax_rate).not.toBeNull();
    expect(result.base_net_price).toBe(0);
    expect(result.approach_fee_net).toBe(0);
  });

  test('tiered_km 15 km → net=11.00, gross=11.77, tax_rate=0.07', () => {
    // Tiers: first 10 km at €1.00/km, beyond 10 km at €0.20/km
    // Total: 10×1.0 + 5×0.2 = 11.00 net; 11.00 × 1.07 = 11.77 gross
    const ctx: PricingContext = {
      rules: [
        rule({
          strategy: 'tiered_km',
          config: {
            tiers: [
              { from_km: 0, to_km: 10, price_per_km: 1.0 },
              { from_km: 10, to_km: null, price_per_km: 0.2 }
            ]
          }
        })
      ],
      clientPriceTags: [],
      clientPriceTag: null
    };
    const result = computeTripPrice(
      { ...baseTrip, driving_distance_km: 15 },
      ctx
    );
    expect(result.gross_price).toBe(11.77);
    expect(result.tax_rate).toBe(0.07);
    expect(result.base_net_price).toBe(11.0);
    expect(result.approach_fee_net).toBe(0);
  });

  test('gross-basis tiered_km — snapshot matches (base_net + approach) × (1 + tax)', () => {
    const ctx: PricingContext = {
      rules: [
        rule({
          strategy: 'tiered_km',
          pricing_basis: 'gross',
          config: {
            tiers: [{ from_km: 0, to_km: null, price_per_km: 1.07 }],
            approach_fee_net: 2
          }
        })
      ],
      clientPriceTags: [],
      clientPriceTag: null
    };
    const result = computeTripPrice(
      { ...baseTrip, driving_distance_km: 10 },
      ctx
    );
    expect(result.base_net_price).toBe(10);
    expect(result.approach_fee_net).toBe(2);
    expect(result.tax_rate).toBe(0.07);
    expect(result.gross_price).toBe(12.84);
  });

  test('tiered_km with null distance → all three null (distance required)', () => {
    const ctx: PricingContext = {
      rules: [
        rule({
          strategy: 'tiered_km',
          config: {
            tiers: [{ from_km: 0, to_km: null, price_per_km: 1.5 }]
          }
        })
      ],
      clientPriceTags: [],
      clientPriceTag: null
    };
    const result = computeTripPrice(
      { ...baseTrip, driving_distance_km: null, net_price: null },
      ctx
    );
    expect(result.gross_price).toBeNull();
    expect(result.tax_rate).toBeNull();
    expect(result.base_net_price).toBeNull();
    expect(result.approach_fee_net).toBeNull();
  });

  test('client price tag (P1) beats tiered_km rule (P2)', () => {
    // clientPriceTags in context — resolvePricingRule synthesises a STEP 0 rule
    const ctx: PricingContext = {
      rules: [
        rule({
          strategy: 'tiered_km',
          config: {
            tiers: [{ from_km: 0, to_km: null, price_per_km: 5 }]
          }
        })
      ],
      clientPriceTags: [
        {
          id: 'tag1',
          client_id: 'client1',
          payer_id: 'payer1',
          billing_variant_id: null,
          price_gross: 32.6,
          is_active: true
        }
      ],
      clientPriceTag: null
    };
    const result = computeTripPrice(
      {
        ...baseTrip,
        client_id: 'client1',
        driving_distance_km: 15
      },
      ctx
    );
    // P1 client_price_tag gross = 32.60; net = 32.6/1.07 ≈ 30.47
    expect(result.gross_price).toBe(32.6);
    expect(result.tax_rate).toBe(0.07);
    expect(result.base_net_price).toBeCloseTo(32.6 / 1.07, 5);
    expect(result.approach_fee_net).toBe(0);
  });

  test('no_price strategy → all three null', () => {
    const ctx: PricingContext = {
      rules: [
        rule({
          strategy: 'no_price',
          config: {}
        })
      ],
      clientPriceTags: [],
      clientPriceTag: null
    };
    const result = computeTripPrice({ ...baseTrip, net_price: null }, ctx);
    expect(result.gross_price).toBeNull();
    expect(result.tax_rate).toBeNull();
    expect(result.base_net_price).toBeNull();
    expect(result.approach_fee_net).toBeNull();
  });

  test('tax_rate is null whenever resolution is unresolved', () => {
    // No rule, no net_price → unresolved → all null
    const result = computeTripPrice({ ...baseTrip, net_price: null }, emptyCtx);
    expect(result.tax_rate).toBeNull();
    expect(result.gross_price).toBeNull();
    expect(result.base_net_price).toBeNull();
    expect(result.approach_fee_net).toBeNull();
  });

  test('tiered_km with approach_fee_net=3.80 — gross from base + Anfahrtspreis', () => {
    // Tiers: 0–5 km @€2.00, 5+ km @€1.99
    // Distance: 5.469 km
    // Base net: 5×2.00 + 0.469×1.99 = 10.00 + 0.93331 → roundOnce = 10.93
    // Total net: 10.93 + 3.80 = 14.73
    // Total gross: round(14.73 × 1.07 × 100)/100 = round(1576.11)/100 = 15.76
    const ctx: PricingContext = {
      rules: [
        rule({
          strategy: 'tiered_km',
          config: {
            tiers: [
              { from_km: 0, to_km: 5, price_per_km: 2.0 },
              { from_km: 5, to_km: null, price_per_km: 1.99 }
            ],
            approach_fee_net: 3.8
          }
        })
      ],
      clientPriceTags: [],
      clientPriceTag: null
    };
    const result = computeTripPrice(
      { ...baseTrip, driving_distance_km: 5.469 },
      ctx
    );
    // Combined net on trip row is DB-generated in Phase 2; here: 10.93 + 3.80 = 14.73
    expect(result.gross_price).toBe(15.76);
    expect(result.tax_rate).toBe(0.07);
    expect(result.base_net_price).toBe(10.93);
    expect(result.approach_fee_net).toBe(3.8);
  });
});

// ─── shouldRecalculatePrice ────────────────────────────────────────────────────

describe('shouldRecalculatePrice', () => {
  test('returns true — patch contains payer_id', () => {
    expect(shouldRecalculatePrice({ payer_id: 'p1' })).toBe(true);
  });

  test('returns true — patch contains driving_distance_km', () => {
    expect(shouldRecalculatePrice({ driving_distance_km: 12.5 })).toBe(true);
  });

  test('returns true — patch contains kts_document_applies', () => {
    expect(shouldRecalculatePrice({ kts_document_applies: true })).toBe(true);
  });

  test('returns true — patch contains pickup_lat (coordinate safety net)', () => {
    expect(shouldRecalculatePrice({ pickup_lat: 52.5 })).toBe(true);
  });

  test('returns true — patch contains dropoff_lng (coordinate safety net)', () => {
    expect(shouldRecalculatePrice({ dropoff_lng: 13.4 })).toBe(true);
  });

  test('returns false — patch contains only status and notes', () => {
    expect(shouldRecalculatePrice({ status: 'completed', notes: 'done' })).toBe(
      false
    );
  });

  test('returns false — patch contains only driver_id', () => {
    expect(shouldRecalculatePrice({ driver_id: 'driver-uuid' })).toBe(false);
  });

  test('returns false — empty patch', () => {
    expect(shouldRecalculatePrice({})).toBe(false);
  });
});

// ─── computeTripPrice in edit context (merged input) ──────────────────────────

describe('computeTripPrice — edit context (merged input)', () => {
  function rule(
    partial: Partial<BillingPricingRuleLike> &
      Pick<BillingPricingRuleLike, 'strategy' | 'config'>
  ): BillingPricingRuleLike {
    return {
      id: 'r1',
      company_id: 'co1',
      payer_id: partial.payer_id ?? 'payer1',
      billing_type_id: partial.billing_type_id ?? null,
      billing_variant_id: partial.billing_variant_id ?? null,
      strategy: partial.strategy,
      config: partial.config,
      pricing_basis: partial.pricing_basis ?? 'net',
      is_active: partial.is_active ?? true,
      _price_gross: partial._price_gross
    };
  }

  test('patch changes payer_id — merged input uses new payer rule, not old row price', () => {
    // Simulates: current row has payer A (tiered_km → 11.00),
    // patch changes to payer B (flat manual_trip_price → no rule, falls to P3 or null).
    // The merged input (net_price: null) with payer B's context (flat rule → 20.00)
    // should produce 20.00, not the old payer A price.
    const ctxPayerB: PricingContext = {
      rules: [
        rule({
          payer_id: 'payer-b',
          strategy: 'tiered_km',
          config: {
            tiers: [{ from_km: 0, to_km: null, price_per_km: 2.0 }]
          }
        })
      ],
      clientPriceTags: [],
      clientPriceTag: null
    };

    // merged input: patch payer_id overwrites current row's payer_id
    const mergedInput: ComputeTripPriceInput = {
      payer_id: 'payer-b', // from patch
      billing_type_id: null,
      billing_variant_id: null,
      client_id: null,
      driving_distance_km: 10, // from current row
      scheduled_at: '2026-06-15T10:00:00.000Z',
      kts_document_applies: false,
      net_price: null, // always null — P4 must not inherit old value
      base_net_price: null,
      manual_gross_price: null
    };

    const result = computeTripPrice(mergedInput, ctxPayerB);
    // 10 km × €2.00 = 20.00 net
    expect(result.gross_price).toBe(21.4); // 20.00 × 1.07
    expect(result.tax_rate).toBe(0.07);
    expect(result.base_net_price).toBe(20.0);
    expect(result.approach_fee_net).toBe(0);
  });

  test('stored trip base never used in recalc — merged input yields null, not 99.99', () => {
    // Simulates: current row had base_net_price = 99.99 (historical).
    // resolveTripForPricing nulls both net fields so P3/P4 cannot fire on 99.99.
    const emptyCtx: PricingContext = {
      rules: [],
      clientPriceTags: [],
      clientPriceTag: null
    };

    // If base_net_price were inherited, P4 would fire and return 99.99.
    const mergedInput: ComputeTripPriceInput = {
      payer_id: 'payer1',
      billing_type_id: null,
      billing_variant_id: null,
      client_id: null,
      driving_distance_km: 15,
      scheduled_at: '2026-06-15T10:00:00.000Z',
      kts_document_applies: false,
      net_price: null, // always null from resolveTripForPricing
      base_net_price: null,
      manual_gross_price: null
    };

    const result = computeTripPrice(mergedInput, emptyCtx);
    expect(result.gross_price).toBeNull();
    expect(result.tax_rate).toBeNull();
    expect(result.base_net_price).toBeNull();
    expect(result.approach_fee_net).toBeNull();
  });

  test('coordinate-only patch triggers recalculation using current row distance', () => {
    // Simulates: patch = { pickup_lat: 53.12 } (address update without new distance).
    // resolveTripForPricing merges: driving_distance_km comes from current row (5.0 km).
    // shouldRecalculatePrice returns true because pickup_lat is pricing-relevant.
    // computeTripPrice uses 5.0 km correctly.
    const ctx: PricingContext = {
      rules: [
        rule({
          strategy: 'tiered_km',
          config: {
            tiers: [{ from_km: 0, to_km: null, price_per_km: 2.0 }]
          }
        })
      ],
      clientPriceTags: [],
      clientPriceTag: null
    };

    // merged input: patch has no driving_distance_km → current row's 5.0 km is used
    const mergedInput: ComputeTripPriceInput = {
      payer_id: 'payer1',
      billing_type_id: null,
      billing_variant_id: null,
      client_id: null,
      driving_distance_km: 5.0, // from current DB row (patch had none)
      scheduled_at: '2026-06-15T10:00:00.000Z',
      kts_document_applies: false,
      net_price: null,
      base_net_price: null,
      manual_gross_price: null
    };

    const result = computeTripPrice(mergedInput, ctx);
    // 5 km × €2.00 = 10.00 net; 10.00 × 1.07 = 10.70 gross
    expect(result.gross_price).toBe(10.7);
    expect(result.tax_rate).toBe(0.07);
    expect(result.base_net_price).toBe(10.0);
    expect(result.approach_fee_net).toBe(0);
  });
});
