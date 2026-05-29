import { describe, expect, test } from 'bun:test';

import { calculateInvoiceTotals } from '@/features/invoices/api/invoice-line-items.api';
import { lineItemGrossTotalForDisplay } from '@/features/invoices/lib/line-item-net-display';
import type { BuilderLineItem } from '@/features/invoices/types/invoice.types';

/**
 * Mirrors net-anchor header math using the **wrong** transport reconstruction
 * (`unit × qty` only) for a single line — used to prove tiered drift vs `net`.
 */
function singleLineBruttoViaUnitTimesQtyOnly(item: BuilderLineItem): number {
  const rate = item.tax_rate;
  const approach = item.approach_fee_net ?? 0;
  const baseNet =
    item.unit_price !== null ? item.unit_price * item.quantity : 0;
  const lineTotal = baseNet + approach;
  const taxNonTag = Math.round(lineTotal * rate * 100) / 100;
  return Math.round((lineTotal + taxNonTag) * 100) / 100;
}

function manualOverrideLineSkewedNet(
  overrides: Partial<BuilderLineItem> = {}
): BuilderLineItem {
  const taxRate = 0.07;
  const manualGrossTotal = 25;
  // Correct transport net for 25 € brutto (7 %), Anfahrt 0: 25 / 1.07 ≈ 23.3645…
  // Skew unit_price low so (net + rounded VAT) reproduces 24.98 €, not 25.00 €.
  const skewedUnitNet = 23.35;
  return {
    trip_id: 't-skew',
    position: 1,
    line_date: null,
    description: 'Skewed manual gross test',
    client_name: null,
    pickup_address: null,
    dropoff_address: null,
    distance_km: 10,
    effective_distance_km: 10,
    original_distance_km: 10,
    manual_km_enabled: false,
    unit_price: skewedUnitNet,
    quantity: 1,
    tax_rate: taxRate,
    billing_variant_code: null,
    billing_variant_name: null,
    billing_type_name: null,
    kts_document_applies: false,
    no_invoice_warning: false,
    price_resolution: {
      gross: manualGrossTotal,
      net: skewedUnitNet,
      tax_rate: taxRate,
      strategy_used: 'manual_trip_price',
      source: 'trip_price',
      unit_price_net: skewedUnitNet,
      quantity: 1,
      approach_fee_net: 0
    },
    kts_override: false,
    trip_meta: null,
    price_source: null,
    warnings: [],
    billingInclusion: { included: true, reason: '' },
    manualGrossTotal,
    manualApproachFeeGross: 0,
    isManualOverride: true,
    approach_fee_gross: 0,
    approach_fee_net: 0,
    ...overrides
  };
}

describe('calculateInvoiceTotals — manual gross override', () => {
  test('footer total matches display helper; net path would differ (skew proof)', () => {
    const item = manualOverrideLineSkewedNet();

    expect(lineItemGrossTotalForDisplay(item)).toBe(25);

    const wrongTransportBrutto = singleLineBruttoViaUnitTimesQtyOnly(item);
    expect(wrongTransportBrutto).not.toBe(item.manualGrossTotal);
    expect(wrongTransportBrutto).toBe(24.98);

    expect(calculateInvoiceTotals([item]).total).toBe(
      lineItemGrossTotalForDisplay(item)
    );
  });

  test('tiered_km: header uses price_resolution.net not unit × qty', () => {
    const taxRate = 0.07;
    const transportNet = 41.55;
    const unitPerKm = 2.07;
    const qty = 20.1;
    const approach = 3.8;
    const item: BuilderLineItem = {
      trip_id: 't-tier',
      position: 1,
      line_date: null,
      description: 'Tier drift',
      client_name: null,
      pickup_address: null,
      dropoff_address: null,
      distance_km: qty,
      effective_distance_km: qty,
      original_distance_km: qty,
      manual_km_enabled: false,
      unit_price: unitPerKm,
      quantity: qty,
      tax_rate: taxRate,
      billing_variant_code: null,
      billing_variant_name: null,
      billing_type_name: null,
      kts_document_applies: false,
      no_invoice_warning: false,
      price_resolution: {
        gross: null,
        net: transportNet,
        tax_rate: taxRate,
        strategy_used: 'tiered_km',
        source: 'payer',
        unit_price_net: unitPerKm,
        quantity: qty,
        approach_fee_net: approach
      },
      kts_override: false,
      trip_meta: null,
      price_source: null,
      warnings: [],
      billingInclusion: { included: true, reason: '' },
      approach_fee_net: approach,
      approach_fee_gross: Math.round(approach * (1 + taxRate) * 100) / 100
    };

    expect(unitPerKm * qty).not.toBeCloseTo(transportNet, 5);

    const lineNet = transportNet + approach;
    const taxBucket = Math.round(lineNet * taxRate * 100) / 100;
    const expectedTotal = Math.round((lineNet + taxBucket) * 100) / 100;
    expect(calculateInvoiceTotals([item]).total).toBe(expectedTotal);
    expect(lineItemGrossTotalForDisplay(item)).toBe(
      Math.round((transportNet + approach) * (1 + taxRate) * 100) / 100
    );

    const wrongTotal = singleLineBruttoViaUnitTimesQtyOnly(item);
    expect(wrongTotal).not.toBe(expectedTotal);
  });
});
