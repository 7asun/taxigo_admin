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
    is_active: partial.is_active ?? true,
    _price_gross: partial._price_gross
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

  test('client_price_tag 32.60 @ 7% — 13 trips gross total must be exactly 423.80', () => {
    const r = resolveTripPrice(
      { ...baseTrip, client: { price_tag: 32.6 }, driving_distance_km: 10 },
      0.07,
      null
    );
    expect(r.strategy_used).toBe('client_price_tag');
    expect(r.gross).toBe(32.6);
    const gross13 = Math.round(r.gross! * 13 * 100) / 100;
    expect(gross13).toBe(423.8);
  });

  test('client_price_tag 32.60 @ 7% — unit_price_net is not pre-rounded', () => {
    const r = resolveTripPrice(
      { ...baseTrip, client: { price_tag: 32.6 }, driving_distance_km: 10 },
      0.07,
      null
    );
    expect(r.unit_price_net).not.toBe(30.47);
    expect(r.unit_price_net!).toBeCloseTo(32.6 / 1.07, 8);
  });

  test('rule _price_gross (client_price_tags) beats legacy clients.price_tag', () => {
    const r = resolveTripPrice(
      {
        ...baseTrip,
        client: { price_tag: 10 },
        driving_distance_km: 100
      },
      0.19,
      {
        ...rule({
          payer_id: null,
          billing_type_id: null,
          billing_variant_id: null,
          strategy: 'client_price_tag',
          config: {}
        }),
        _price_gross: 119
      }
    );
    expect(r.strategy_used).toBe('client_price_tag');
    expect(r.gross).toBe(119);
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

  test('negotiated price_tag: no approach_fee_net even if rule has Anfahrt', () => {
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
          tiers: [{ from_km: 0, to_km: null, price_per_km: 99 }],
          approach_fee_net: 5
        }
      })
    );
    expect(r.source).toBe('client_price_tag');
    expect(r.approach_fee_net).toBeUndefined();
  });

  test('KTS: no approach_fee_net on resolution', () => {
    const r = resolveTripPrice(
      { ...baseTrip, kts_document_applies: true },
      0.19,
      rule({
        payer_id: 'p1',
        billing_type_id: null,
        billing_variant_id: null,
        strategy: 'tiered_km',
        config: {
          tiers: [{ from_km: 0, to_km: null, price_per_km: 2 }],
          approach_fee_net: 5
        }
      })
    );
    expect(r.source).toBe('kts_override');
    expect(r.approach_fee_net).toBeUndefined();
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

  test('tiered_km merges approach_fee_net from rule config', () => {
    const r = resolveTripPrice(baseTrip, 0.07, {
      ...rule({
        strategy: 'tiered_km',
        config: {
          tiers: [{ from_km: 0, to_km: null, price_per_km: 2 }],
          approach_fee_net: 5
        }
      }),
      payer_id: 'p1',
      billing_type_id: null,
      billing_variant_id: null
    });
    expect(r.strategy_used).toBe('tiered_km');
    expect(r.net).toBe(20);
    expect(r.approach_fee_net).toBe(5);
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
