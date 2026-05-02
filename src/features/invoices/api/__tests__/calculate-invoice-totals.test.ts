import { describe, expect, test } from 'bun:test';

import { calculateInvoiceTotals } from '@/features/invoices/api/invoice-line-items.api';
import { lineItemGrossTotalForDisplay } from '@/features/invoices/lib/line-item-net-display';
import type { BuilderLineItem } from '@/features/invoices/types/invoice.types';

/**
 * Mirrors the pre-fix net-anchor branch for a single line (same rounding as
 * `calculateInvoiceTotals` when the line would fall through to the else-branch).
 * Used to prove the mock is skewed: this value must differ from `manualGrossTotal`.
 */
function singleLineBruttoViaNetAnchorPath(item: BuilderLineItem): number {
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

    const netPathBrutto = singleLineBruttoViaNetAnchorPath(item);
    expect(netPathBrutto).not.toBe(item.manualGrossTotal);
    expect(netPathBrutto).toBe(24.98);

    expect(calculateInvoiceTotals([item]).total).toBe(
      lineItemGrossTotalForDisplay(item)
    );
  });
});
