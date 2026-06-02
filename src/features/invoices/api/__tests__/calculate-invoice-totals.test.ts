import { describe, expect, test } from 'bun:test';

import { calculateInvoiceTotals } from '@/features/invoices/api/invoice-line-items.api';
import { lineItemGrossTotalForDisplay } from '@/features/invoices/lib/line-item-net-display';
import { TAX_RATES } from '@/features/invoices/lib/tax-calculator';
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
    is_wheelchair: false,
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
      is_wheelchair: false,
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

function simpleNetAnchorLine(
  taxRate: number,
  transportNet: number,
  position: number
): BuilderLineItem {
  return {
    trip_id: `t-${position}`,
    position,
    line_date: null,
    description: 'Line',
    client_name: null,
    pickup_address: null,
    dropoff_address: null,
    distance_km: 10,
    effective_distance_km: 10,
    original_distance_km: 10,
    manual_km_enabled: false,
    unit_price: transportNet,
    quantity: 1,
    tax_rate: taxRate,
    billing_variant_code: null,
    billing_variant_name: null,
    billing_type_name: null,
    kts_document_applies: false,
    no_invoice_warning: false,
    is_wheelchair: false,
    price_resolution: {
      gross: transportNet * (1 + taxRate),
      net: transportNet,
      tax_rate: taxRate,
      strategy_used: 'fixed_price',
      source: 'payer',
      unit_price_net: transportNet,
      quantity: 1,
      approach_fee_net: 0
    },
    kts_override: false,
    trip_meta: null,
    price_source: null,
    warnings: [],
    billingInclusion: { included: true, reason: '' },
    approach_fee_net: 0,
    approach_fee_gross: 0
  };
}

describe('calculateInvoiceTotals — zero VAT rate', () => {
  test('0% and 7% lines → two breakdown buckets', () => {
    const zero = simpleNetAnchorLine(TAX_RATES.ZERO, 100, 1);
    const seven = simpleNetAnchorLine(TAX_RATES.REDUCED, 50, 2);
    const totals = calculateInvoiceTotals([zero, seven]);
    expect(totals.breakdown).toHaveLength(2);
    const zeroBucket = totals.breakdown.find((b) => b.rate === TAX_RATES.ZERO);
    const sevenBucket = totals.breakdown.find(
      (b) => b.rate === TAX_RATES.REDUCED
    );
    expect(zeroBucket?.tax).toBe(0);
    expect(zeroBucket?.net).toBe(100);
    expect(sevenBucket?.net).toBe(50);
    expect(sevenBucket?.tax).toBeCloseTo(3.5, 2);
  });

  test('0% only → tax 0 and net equals gross total', () => {
    const line = simpleNetAnchorLine(TAX_RATES.ZERO, 80, 1);
    const totals = calculateInvoiceTotals([line]);
    expect(totals.breakdown).toHaveLength(1);
    expect(totals.breakdown[0].rate).toBe(TAX_RATES.ZERO);
    expect(totals.breakdown[0].tax).toBe(0);
    expect(totals.total).toBe(80);
    expect(totals.subtotal).toBe(80);
    expect(totals.taxAmount).toBe(0);
  });

  test('mixed 0% / 7% / 19% → three buckets sum to total', () => {
    const lines = [
      simpleNetAnchorLine(TAX_RATES.ZERO, 100, 1),
      simpleNetAnchorLine(TAX_RATES.REDUCED, 50, 2),
      simpleNetAnchorLine(TAX_RATES.STANDARD, 40, 3)
    ];
    const totals = calculateInvoiceTotals(lines);
    expect(totals.breakdown).toHaveLength(3);
    const sumNet = totals.breakdown.reduce((s, b) => s + b.net, 0);
    const sumTax = totals.breakdown.reduce((s, b) => s + b.tax, 0);
    expect(Math.round((sumNet + sumTax) * 100) / 100).toBe(totals.total);
  });
});
