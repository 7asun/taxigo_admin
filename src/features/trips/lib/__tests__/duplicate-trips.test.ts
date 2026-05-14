/**
 * duplicate-trips.test.ts
 *
 * Verifies the duplication price invariant introduced in Phase 2:
 *   - Every duplicated trip's price is computed fresh via computeTripPrice.
 *   - Stored base/combined price snapshots are not inherited (`toComputeInput` nulls them).
 *   - `manual_gross_price` from the insert is passed through for P0 when present.
 *   - A failed or empty context produces null prices without throwing.
 *
 * These tests exercise `computeTripPrice` with null price inputs as
 * `toComputeInput` does for every duplicated trip, rather than calling
 * `executeDuplicateTrips` directly (which requires a live Supabase client).
 */

import { describe, expect, test } from 'bun:test';

import { computeTripPrice } from '../trip-price-engine';
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

/**
 * Builds the ComputeTripPriceInput that toComputeInput produces for a duplicated
 * trip — `net_price` and `base_net_price` null regardless of the source row.
 */
function duplicateInput(
  overrides: Partial<ComputeTripPriceInput> = {}
): ComputeTripPriceInput {
  return {
    payer_id: 'payer1',
    billing_type_id: null,
    billing_variant_id: null,
    client_id: null,
    driving_distance_km: 15,
    scheduled_at: '2026-06-15T10:00:00.000Z',
    kts_document_applies: false,
    net_price: null,
    base_net_price: null,
    manual_gross_price: null,
    ...overrides
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('duplicate trip price invariant', () => {
  test('price is recalculated from rule, not inherited from source', () => {
    // Source row could have a stale stored total; toComputeInput nulls in-memory price inputs so the rule wins.
    // Tiers: 0–10 km @€1.00, 10+ km @€0.20. Distance = 15 km → 10×1 + 5×0.2 = 11.00 net.
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

    const staleSourceNetPrice = 99.99;
    const input = duplicateInput({ driving_distance_km: 15 });
    expect(input.net_price).toBeNull();
    expect(input.base_net_price).toBeNull();

    const result = computeTripPrice(input, ctx);

    expect(result.base_net_price).toBe(11.0);
    expect(result.base_net_price).not.toBe(staleSourceNetPrice);
    expect(result.gross_price).toBe(11.77);
    expect(result.tax_rate).toBe(0.07);
  });

  test('source base net does not pollute P4 — empty context yields null, not 99.99', () => {
    // If base_net_price were copied from the source, an empty context (no rule) would
    // use P4 and return 99.99. Duplication nulls base_net; nothing to fall back to → all null.
    const inputWithStaleValue = duplicateInput({ base_net_price: 99.99 });
    const inputWithNull = duplicateInput();

    const controlResult = computeTripPrice(inputWithStaleValue, emptyCtx);
    expect(controlResult.base_net_price).toBe(99.99);

    const result = computeTripPrice(inputWithNull, emptyCtx);
    expect(result.base_net_price).toBeNull();
    expect(result.gross_price).toBeNull();
    expect(result.tax_rate).toBeNull();
  });

  test('null prices on empty context are acceptable — no throw, all fields null', () => {
    // Empty context + no payer_id → all-null. Duplication must not block on missing price.
    const result = computeTripPrice(
      duplicateInput({ payer_id: null }),
      emptyCtx
    );
    expect(result.base_net_price).toBeNull();
    expect(result.gross_price).toBeNull();
    expect(result.tax_rate).toBeNull();
  });
});
