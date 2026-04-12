import { describe, expect, test } from 'bun:test';

import { resolvePricingRule } from '../resolve-pricing-rule';
import type {
  BillingPricingRuleLike,
  ClientPriceTagLike
} from '@/features/invoices/types/pricing.types';

function rule(
  partial: Partial<BillingPricingRuleLike> &
    Pick<BillingPricingRuleLike, 'strategy' | 'config'>
): BillingPricingRuleLike {
  return {
    id: partial.id ?? 'r1',
    company_id: partial.company_id ?? 'c1',
    payer_id: partial.payer_id ?? null,
    billing_type_id: partial.billing_type_id ?? null,
    billing_variant_id: partial.billing_variant_id ?? null,
    strategy: partial.strategy,
    config: partial.config,
    is_active: partial.is_active ?? true,
    _price_gross: partial._price_gross
  };
}

function cpt(
  partial: Partial<ClientPriceTagLike> & Pick<ClientPriceTagLike, 'id'>
): ClientPriceTagLike {
  return {
    id: partial.id,
    client_id: partial.client_id ?? 'cl1',
    payer_id: partial.payer_id ?? null,
    billing_variant_id: partial.billing_variant_id ?? null,
    price_gross: partial.price_gross ?? 10,
    is_active: partial.is_active ?? true
  };
}

describe('resolvePricingRule', () => {
  const payerId = 'p1';
  const typeId = 'bt1';
  const variantId = 'bv1';

  test('no rules, no tags → null', () => {
    const r = resolvePricingRule({
      rules: [],
      payerId,
      billingTypeId: typeId,
      billingVariantId: variantId,
      clientId: null,
      clientPriceTags: []
    });
    expect(r).toBeNull();
  });

  test('variant billing rule wins over payer-wide billing rule', () => {
    const variantRule = rule({
      id: 'rv',
      billing_variant_id: variantId,
      payer_id: null,
      billing_type_id: null,
      strategy: 'tiered_km',
      config: { tiers: [] }
    });
    const payerRule = rule({
      id: 'rp',
      payer_id: payerId,
      billing_type_id: null,
      billing_variant_id: null,
      strategy: 'manual_trip_price',
      config: {}
    });
    const out = resolvePricingRule({
      rules: [payerRule, variantRule],
      payerId,
      billingTypeId: typeId,
      billingVariantId: variantId,
      clientId: null
    });
    expect(out?.id).toBe('rv');
  });

  test('client+variant tag beats client+payer tag beats global tag', () => {
    const tags = [
      cpt({
        id: 'g',
        price_gross: 5,
        payer_id: null,
        billing_variant_id: null
      }),
      cpt({
        id: 'p',
        payer_id: payerId,
        billing_variant_id: null,
        price_gross: 15
      }),
      cpt({
        id: 'v',
        billing_variant_id: variantId,
        payer_id: null,
        price_gross: 25
      })
    ];
    const payerRule = rule({
      id: 'rp',
      payer_id: payerId,
      strategy: 'manual_trip_price',
      config: {}
    });
    const out = resolvePricingRule({
      rules: [payerRule],
      payerId,
      billingTypeId: typeId,
      billingVariantId: variantId,
      clientId: 'cl1',
      clientPriceTags: tags
    });
    expect(out?.strategy).toBe('client_price_tag');
    expect(out?._price_gross).toBe(25);
  });

  test('client+payer tag beats billing variant rule for same trip', () => {
    const tags = [
      cpt({
        id: 'p',
        payer_id: payerId,
        billing_variant_id: null,
        price_gross: 99
      })
    ];
    const variantRule = rule({
      id: 'rv',
      billing_variant_id: variantId,
      strategy: 'tiered_km',
      config: { tiers: [] }
    });
    const out = resolvePricingRule({
      rules: [variantRule],
      payerId,
      billingTypeId: typeId,
      billingVariantId: variantId,
      clientId: 'cl1',
      clientPriceTags: tags
    });
    expect(out?._price_gross).toBe(99);
    expect(out?.strategy).toBe('client_price_tag');
  });

  test('clientId null skips tag step — existing waterfall unchanged', () => {
    const tags = [
      cpt({
        id: 'p',
        payer_id: payerId,
        price_gross: 99
      })
    ];
    const variantRule = rule({
      id: 'rv',
      billing_variant_id: variantId,
      strategy: 'tiered_km',
      config: { tiers: [] }
    });
    const out = resolvePricingRule({
      rules: [variantRule],
      payerId,
      billingTypeId: typeId,
      billingVariantId: variantId,
      clientId: null,
      clientPriceTags: tags
    });
    expect(out?.id).toBe('rv');
  });

  test('inactive tag is ignored', () => {
    const tags = [
      cpt({
        id: 'p',
        payer_id: payerId,
        price_gross: 99,
        is_active: false
      })
    ];
    const variantRule = rule({
      id: 'rv',
      billing_variant_id: variantId,
      strategy: 'tiered_km',
      config: { tiers: [] }
    });
    const out = resolvePricingRule({
      rules: [variantRule],
      payerId,
      billingTypeId: typeId,
      billingVariantId: variantId,
      clientId: 'cl1',
      clientPriceTags: tags
    });
    expect(out?.id).toBe('rv');
  });
});
