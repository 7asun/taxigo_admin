import { describe, expect, test } from 'bun:test';

import {
  patchLineItemForTaxRateOverride,
  resetLineItemTaxRateOverride
} from '@/features/invoices/lib/apply-tax-rate-override';
import { lineItemGrossTotalForDisplay } from '@/features/invoices/lib/line-item-net-display';
import { TAX_RATES } from '@/features/invoices/lib/tax-calculator';
import type { BuilderLineItem } from '@/features/invoices/types/invoice.types';
import type { PriceResolution } from '@/features/invoices/types/pricing.types';

function baseItem(
  overrides: Partial<BuilderLineItem> & {
    price_resolution: PriceResolution;
  }
): BuilderLineItem {
  return {
    trip_id: 'trip-1',
    position: 1,
    line_date: '2026-06-15T10:00:00.000Z',
    description: 'Test',
    client_name: 'Test Client',
    pickup_address: null,
    dropoff_address: null,
    distance_km: 10,
    effective_distance_km: 10,
    original_distance_km: 10,
    manual_km_enabled: false,
    unit_price: 10,
    quantity: 1,
    tax_rate: TAX_RATES.REDUCED,
    billing_variant_code: null,
    billing_variant_name: null,
    billing_type_name: null,
    kts_document_applies: false,
    no_invoice_warning: false,
    is_wheelchair: false,
    kts_override: false,
    trip_meta: null,
    price_source: null,
    warnings: [],
    billingInclusion: { included: true, reason: '' },
    resolved_rule: null,
    ...overrides
  };
}

describe('patchLineItemForTaxRateOverride', () => {
  test('manual_gross_price: 7% → 0% keeps gross, net rises', () => {
    const gross = 107;
    const item = baseItem({
      price_resolution: {
        gross,
        net: gross / (1 + TAX_RATES.REDUCED),
        tax_rate: TAX_RATES.REDUCED,
        strategy_used: 'manual_trip_price',
        source: 'manual_gross_price',
        unit_price_net: gross / (1 + TAX_RATES.REDUCED),
        quantity: 1,
        approach_fee_net: 0
      }
    });
    const patched = patchLineItemForTaxRateOverride(item, TAX_RATES.ZERO);
    expect(patched.price_resolution.gross).toBe(gross);
    expect(patched.price_resolution.net).toBeCloseTo(gross, 2);
    expect(patched.tax_rate).toBe(TAX_RATES.ZERO);
    expect(patched.isManualTaxRateOverride).toBe(true);
  });

  test('client_price_tag: gross-anchor on rate change', () => {
    const gross = 50;
    const item = baseItem({
      price_resolution: {
        gross,
        net: gross / (1 + TAX_RATES.REDUCED),
        tax_rate: TAX_RATES.REDUCED,
        strategy_used: 'client_price_tag',
        source: 'client_price_tag',
        unit_price_net: gross / (1 + TAX_RATES.REDUCED),
        quantity: 1
      }
    });
    const patched = patchLineItemForTaxRateOverride(item, TAX_RATES.ZERO);
    expect(patched.price_resolution.gross).toBe(gross);
    expect(patched.price_resolution.net).toBeCloseTo(50, 2);
  });

  test('payer net-anchor: 7% → 0% keeps transport net, gross drops', () => {
    const item = baseItem({
      effective_distance_km: 10,
      approach_fee_net: 0,
      price_resolution: {
        gross: 21.4,
        net: 20,
        tax_rate: TAX_RATES.REDUCED,
        strategy_used: 'tiered_km',
        source: 'payer',
        unit_price_net: 2,
        quantity: 10,
        approach_fee_net: 0
      },
      resolved_rule: {
        id: 'r1',
        company_id: 'co',
        payer_id: 'p1',
        billing_type_id: null,
        billing_variant_id: null,
        strategy: 'tiered_km',
        config: {
          tiers: [{ from_km: 0, to_km: null, price_per_km: 2 }]
        },
        pricing_basis: 'net',
        is_active: true
      }
    });
    const patched = patchLineItemForTaxRateOverride(item, TAX_RATES.ZERO);
    expect(patched.price_resolution.net).toBe(20);
    expect(patched.tax_rate).toBe(TAX_RATES.ZERO);
    expect(patched.price_resolution.gross).toBe(20);
  });

  test('kts_override: only tax_rate changes', () => {
    const item = baseItem({
      kts_override: true,
      price_resolution: {
        gross: 0,
        net: 0,
        tax_rate: TAX_RATES.REDUCED,
        strategy_used: 'kts_override',
        source: 'kts_override',
        unit_price_net: 0,
        quantity: 1
      }
    });
    const patched = patchLineItemForTaxRateOverride(item, TAX_RATES.ZERO);
    expect(patched.price_resolution.gross).toBe(0);
    expect(patched.tax_rate).toBe(TAX_RATES.ZERO);
  });

  test('wheelchair trip: full-line display gross stays fixed when tax rate changes', () => {
    const transportNet = 37.38;
    const approachNet = 5.6;
    const item = baseItem({
      is_wheelchair: true,
      unit_price: transportNet,
      approach_fee_net: approachNet,
      effective_distance_km: 14.05,
      price_resolution: {
        gross: 40,
        net: transportNet,
        tax_rate: TAX_RATES.REDUCED,
        strategy_used: 'tiered_km',
        source: 'payer',
        unit_price_net: transportNet,
        quantity: 1,
        approach_fee_net: approachNet
      }
    });

    const displayGrossBefore = lineItemGrossTotalForDisplay(item);
    expect(displayGrossBefore).not.toBeNull();

    const at0 = patchLineItemForTaxRateOverride(item, TAX_RATES.ZERO);
    const at19 = patchLineItemForTaxRateOverride(item, TAX_RATES.STANDARD);

    expect(lineItemGrossTotalForDisplay(at0)).toBeCloseTo(
      displayGrossBefore!,
      2
    );
    expect(lineItemGrossTotalForDisplay(at19)).toBeCloseTo(
      displayGrossBefore!,
      2
    );

    expect(lineItemGrossTotalForDisplay(at0)).toBeCloseTo(
      (at0.price_resolution.net ?? 0) +
        (at0.price_resolution.approach_fee_net ?? 0),
      2
    );
  });

  test('resetLineItemTaxRateOverride clears manual flag', () => {
    const item = baseItem({
      isManualTaxRateOverride: true,
      effective_distance_km: 10,
      tax_rate: TAX_RATES.ZERO,
      price_resolution: {
        gross: 100,
        net: 100,
        tax_rate: TAX_RATES.ZERO,
        strategy_used: 'manual_trip_price',
        source: 'manual_gross_price',
        unit_price_net: 100,
        quantity: 1,
        approach_fee_net: 0
      }
    });
    const patched = resetLineItemTaxRateOverride(item);
    expect(patched.tax_rate).toBe(TAX_RATES.REDUCED);
    expect(patched.isManualTaxRateOverride).toBe(false);
  });
});
