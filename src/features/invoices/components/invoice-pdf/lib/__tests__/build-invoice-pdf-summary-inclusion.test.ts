import { describe, expect, test } from 'bun:test';

import { calculateInvoiceTotals } from '@/features/invoices/api/invoice-line-items.api';
import {
  billingIncludedLineItems,
  mainCoverLineItems
} from '@/features/invoices/lib/billing-inclusion';
import type { InvoiceLineItemRow } from '@/features/invoices/types/invoice.types';
import type { PriceResolution } from '@/features/invoices/types/pricing.types';
import { buildInvoicePdfGroupedByBillingType } from '../build-invoice-pdf-summary';

function minimalLine(
  partial: Pick<
    InvoiceLineItemRow,
    | 'billing_type_name'
    | 'billing_variant_name'
    | 'billing_variant_code'
    | 'tax_rate'
  > &
    Partial<
      Pick<
        InvoiceLineItemRow,
        | 'unit_price'
        | 'quantity'
        | 'approach_fee_net'
        | 'total_price'
        | 'kts_override'
        | 'effective_distance_km'
        | 'distance_km'
        | 'position'
        | 'billing_included'
        | 'is_cancelled_trip'
        | 'price_resolution_snapshot'
      >
    >
): InvoiceLineItemRow {
  return {
    id: partial.position != null ? `li-${partial.position}` : 'x',
    invoice_id: 'inv',
    trip_id: null,
    position: partial.position ?? 1,
    line_date: '2026-01-01T10:00:00.000Z',
    description: 'd',
    client_name: null,
    pickup_address: null,
    dropoff_address: null,
    distance_km: partial.distance_km ?? null,
    effective_distance_km: partial.effective_distance_km ?? null,
    original_distance_km: null,
    unit_price: partial.unit_price ?? 10,
    quantity: partial.quantity ?? 1,
    approach_fee_net: partial.approach_fee_net ?? null,
    total_price: partial.total_price ?? 10.7,
    tax_rate: partial.tax_rate,
    billing_variant_code: partial.billing_variant_code ?? null,
    billing_variant_name: partial.billing_variant_name ?? null,
    billing_type_name: partial.billing_type_name ?? null,
    billing_included: partial.billing_included,
    is_cancelled_trip: partial.is_cancelled_trip,
    created_at: '2026-01-01',
    pricing_strategy_used: 'trip_price_fallback',
    pricing_source: 'trip_price',
    kts_override: partial.kts_override ?? false,
    price_resolution_snapshot: partial.price_resolution_snapshot ?? {
      gross: 10.7,
      net: 10,
      tax_rate: partial.tax_rate,
      strategy_used: 'trip_price_fallback',
      source: 'trip_price',
      unit_price_net: 10,
      quantity: 1
    }
  };
}

function totalsLineFromRow(row: InvoiceLineItemRow) {
  const pr = row.price_resolution_snapshot as unknown as PriceResolution;
  return {
    price_resolution: pr,
    tax_rate: row.tax_rate,
    quantity: row.quantity,
    approach_fee_net: row.approach_fee_net ?? null,
    unit_price: row.unit_price,
    manualGrossTotal: null as number | null
  };
}

describe('mainCoverLineItems + buildInvoicePdfGroupedByBillingType', () => {
  test('opted-out row with km and price does not contribute to cover total_km', () => {
    const rows = [
      minimalLine({
        billing_type_name: 'Abreise',
        billing_variant_name: 'Standard',
        billing_variant_code: 'A',
        tax_rate: 0.07,
        position: 1,
        billing_included: true,
        effective_distance_km: 20,
        unit_price: 10,
        total_price: 10.7
      }),
      minimalLine({
        billing_type_name: 'Abreise',
        billing_variant_name: 'Standard',
        billing_variant_code: 'A',
        tax_rate: 0.07,
        position: 2,
        billing_included: false,
        effective_distance_km: 50,
        unit_price: 99,
        total_price: 105.93
      })
    ];

    const summary = buildInvoicePdfGroupedByBillingType(
      mainCoverLineItems(rows)
    );
    expect(summary).toHaveLength(1);
    expect(summary[0]!.total_km).toBe(20);
    expect(summary[0]!.quantity).toBe(1);
  });

  test('opted-in cancelled trip is excluded from mainCoverLineItems', () => {
    const rows = [
      minimalLine({
        billing_type_name: 'Abreise',
        billing_variant_name: 'Standard',
        billing_variant_code: 'A',
        tax_rate: 0.07,
        billing_included: true,
        is_cancelled_trip: true,
        effective_distance_km: 12
      })
    ];
    expect(mainCoverLineItems(rows)).toHaveLength(0);
  });

  test('one included + one excluded: cover total_km equals included km only', () => {
    const includedKm = 15;
    const excludedKm = 40;
    const rows = [
      minimalLine({
        billing_type_name: 'Dialyse',
        billing_variant_name: 'Standard',
        billing_variant_code: 'D',
        tax_rate: 0.07,
        position: 1,
        billing_included: true,
        effective_distance_km: includedKm
      }),
      minimalLine({
        billing_type_name: 'Dialyse',
        billing_variant_name: 'Standard',
        billing_variant_code: 'D',
        tax_rate: 0.07,
        position: 2,
        billing_included: false,
        effective_distance_km: excludedKm
      })
    ];

    const summary = buildInvoicePdfGroupedByBillingType(
      mainCoverLineItems(rows)
    );
    expect(summary[0]!.total_km).toBe(includedKm);
  });
});

describe('billingIncludedLineItems + calculateInvoiceTotals (footer path)', () => {
  test('excludes opted-out normal; includes opted-in cancelled', () => {
    const normalIncluded = minimalLine({
      billing_type_name: 'Abreise',
      billing_variant_name: 'Standard',
      billing_variant_code: 'A',
      tax_rate: 0.07,
      position: 1,
      billing_included: true,
      unit_price: 10,
      total_price: 10.7
    });
    const normalExcluded = minimalLine({
      billing_type_name: 'Abreise',
      billing_variant_name: 'Standard',
      billing_variant_code: 'A',
      tax_rate: 0.07,
      position: 2,
      billing_included: false,
      unit_price: 200,
      total_price: 214
    });
    const cancelledIncluded = minimalLine({
      billing_type_name: 'Abreise',
      billing_variant_name: 'Standard',
      billing_variant_code: 'A',
      tax_rate: 0.07,
      position: 3,
      billing_included: true,
      is_cancelled_trip: true,
      unit_price: 5,
      total_price: 5.35
    });

    const rows = [normalIncluded, normalExcluded, cancelledIncluded];
    const billable = billingIncludedLineItems(rows);
    expect(billable.map((r) => r.position)).toEqual([1, 3]);

    const totals = calculateInvoiceTotals(billable.map(totalsLineFromRow));
    const includedOnly = calculateInvoiceTotals([
      totalsLineFromRow(normalIncluded),
      totalsLineFromRow(cancelledIncluded)
    ]);
    expect(totals.total).toBe(includedOnly.total);
    expect(totals.subtotal).toBe(includedOnly.subtotal);
  });
});
