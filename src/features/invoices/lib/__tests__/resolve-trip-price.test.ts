import { describe, expect, test } from 'bun:test';

import { tieredNetTotal, resolveTripPrice } from '../resolve-trip-price';
import type { BillingPricingRuleLike } from '@/features/invoices/types/pricing.types';

function rule(
  partial: Partial<BillingPricingRuleLike> &
    Pick<BillingPricingRuleLike, 'strategy' | 'config'>
): BillingPricingRuleLike {
  return {
    id: 'r1',
    company_id: 'c1',
    payer_id: partial.payer_id ?? 'p1',
    billing_type_id: partial.billing_type_id ?? null,
    billing_variant_id: partial.billing_variant_id ?? null,
    strategy: partial.strategy,
    config: partial.config,
    is_active: partial.is_active ?? true
  };
}

describe('tieredNetTotal', () => {
  test('sums segments then rounds once', () => {
    const tiers = [
      { from_km: 0, to_km: 10, price_per_km: 0.333 },
      { from_km: 10, to_km: null, price_per_km: 0.2 }
    ];
    const raw = 10 * 0.333 + 5 * 0.2;
    const expected = Math.round(raw * 100) / 100;
    expect(tieredNetTotal(15, tiers)).toBe(expected);
  });
});

describe('resolveTripPrice', () => {
  const baseTrip = {
    kts_document_applies: false,
    price: null as number | null,
    driving_distance_km: 10 as number | null,
    scheduled_at: '2026-06-15T12:00:00.000Z',
    client: undefined as { price_tag: number | null } | undefined
  };

  test('KTS override', () => {
    const r = resolveTripPrice(
      { ...baseTrip, kts_document_applies: true },
      0.19,
      null
    );
    expect(r.source).toBe('kts_override');
    expect(r.net).toBe(0);
  });

  test('price_tag beats tiered rule', () => {
    const r = resolveTripPrice(
      {
        ...baseTrip,
        client: { price_tag: 119 },
        driving_distance_km: 100
      },
      0.19,
      rule({
        payer_id: 'p1',
        billing_type_id: null,
        billing_variant_id: null,
        strategy: 'tiered_km',
        config: {
          tiers: [{ from_km: 0, to_km: null, price_per_km: 99 }]
        }
      })
    );
    expect(r.source).toBe('client_price_tag');
    expect(r.net).toBeCloseTo(119 / 1.19, 5);
  });

  test('tiered_km when no tag', () => {
    const r = resolveTripPrice(baseTrip, 0.07, {
      ...rule({
        strategy: 'tiered_km',
        config: {
          tiers: [{ from_km: 0, to_km: null, price_per_km: 2 }]
        }
      }),
      payer_id: 'p1',
      billing_type_id: null,
      billing_variant_id: null
    });
    expect(r.strategy_used).toBe('tiered_km');
    expect(r.net).toBe(20);
    expect(r.quantity).toBe(10);
  });

  test('no rule uses trip.price', () => {
    const r = resolveTripPrice({ ...baseTrip, price: 42.5 }, 0.07, null);
    expect(r.source).toBe('trip_price');
    expect(r.net).toBe(42.5);
  });

  test('no_price yields unresolved', () => {
    const r = resolveTripPrice(baseTrip, 0.07, {
      ...rule({ strategy: 'no_price', config: {} }),
      payer_id: 'p1',
      billing_type_id: null,
      billing_variant_id: null
    });
    expect(r.source).toBe('unresolved');
    expect(r.net).toBeNull();
  });
});
