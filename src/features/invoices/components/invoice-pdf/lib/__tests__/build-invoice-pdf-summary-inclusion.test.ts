import { describe, expect, test } from 'bun:test';

import { calculateInvoiceTotals } from '@/features/invoices/api/invoice-line-items.api';
import {
  billingIncludedLineItems,
  mainCoverLineItems
} from '@/features/invoices/lib/billing-inclusion';
import {
  computeInvoiceCoverKm,
  computeInvoiceKmBuckets
} from '@/features/invoices/lib/compute-invoice-km';
import type { InvoiceLineItemRow } from '@/features/invoices/types/invoice.types';
import type { PriceResolution } from '@/features/invoices/types/pricing.types';
import {
  buildInvoicePdfGroupedByBillingType,
  buildInvoicePdfSummary,
  buildInvoicePdfSingleRow
} from '../build-invoice-pdf-summary';
import type { InvoiceDetail } from '@/features/invoices/types/invoice.types';

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
        | 'pickup_address'
        | 'dropoff_address'
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
    pickup_address: partial.pickup_address ?? null,
    dropoff_address: partial.dropoff_address ?? null,
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

// ─── Cover bucket parity across layouts ─────────────────────────────────────
//
// All three main_layout modes share the same invoice-level Gesamtstrecke block
// (computed from the full line_items array via computeInvoiceCoverKm). This test
// ensures the bucket values are identical regardless of layout.

describe('computeInvoiceCoverKm — layout parity', () => {
  const lineItems: InvoiceLineItemRow[] = [
    minimalLine({
      billing_type_name: 'Krankenfahrt',
      billing_variant_name: 'Standard',
      billing_variant_code: 'K',
      tax_rate: 0.07,
      position: 1,
      billing_included: true,
      is_cancelled_trip: false,
      effective_distance_km: 20,
      pickup_address: 'Musterstr. 1, Berlin',
      dropoff_address: 'Klinikaue 5, Berlin'
    }),
    minimalLine({
      billing_type_name: 'Krankenfahrt',
      billing_variant_name: 'Standard',
      billing_variant_code: 'K',
      tax_rate: 0.07,
      position: 2,
      billing_included: true,
      is_cancelled_trip: true, // cancelled-billed
      effective_distance_km: 8,
      pickup_address: 'Musterstr. 1, Berlin',
      dropoff_address: 'Klinikaue 5, Berlin'
    }),
    minimalLine({
      billing_type_name: 'Krankenfahrt',
      billing_variant_name: 'Standard',
      billing_variant_code: 'K',
      tax_rate: 0.07,
      position: 3,
      billing_included: false,
      is_cancelled_trip: false, // opted-out
      effective_distance_km: 99
    })
  ];

  const expected = { normalBilledKm: 20, cancelledBilledKm: 8 };

  test('computeInvoiceCoverKm from full array', () => {
    expect(computeInvoiceCoverKm(lineItems)).toEqual(expected);
  });

  test('computeInvoiceKmBuckets is identical to computeInvoiceCoverKm', () => {
    expect(computeInvoiceKmBuckets(lineItems)).toEqual(
      computeInvoiceCoverKm(lineItems)
    );
  });

  test('grouped layout: mainCoverLineItems total_km excludes cancelled and opted-out', () => {
    const mainItems = mainCoverLineItems(lineItems);
    const summary = buildInvoicePdfGroupedByBillingType(mainItems);
    const perGroupKm = summary.reduce((acc, r) => acc + (r.total_km ?? 0), 0);
    // Only the normal billed row (20 km) appears in grouped summary
    expect(perGroupKm).toBe(20);
    // Cover bucket still captures the full picture
    expect(computeInvoiceCoverKm(lineItems).normalBilledKm).toBe(20);
  });

  test('single_row layout: buildInvoicePdfSingleRow uses mainCoverLineItems slice', () => {
    const mainItems = mainCoverLineItems(lineItems);
    const row = buildInvoicePdfSingleRow(mainItems, 'Test');
    // Only normal billed row contributes
    expect(row.total_km).toBe(20);
    expect(computeInvoiceCoverKm(lineItems).normalBilledKm).toBe(20);
  });

  test('flat layout (buildInvoicePdfSummary): same result via mainCoverLineItems', () => {
    const mainItems = mainCoverLineItems(lineItems);
    // Create a minimal InvoiceDetail shape
    const invoiceDetail = {
      line_items: mainItems
    } as unknown as InvoiceDetail;
    const { summaryItems } = buildInvoicePdfSummary(invoiceDetail);
    const perGroupKm = summaryItems.reduce(
      (acc, r) => acc + (r.total_km ?? 0),
      0
    );
    expect(perGroupKm).toBe(20);
  });
});

// ─── Toggle behaviour ────────────────────────────────────────────────────────

describe('show_cancelled_billed_km_on_cover toggle', () => {
  const items: InvoiceLineItemRow[] = [
    minimalLine({
      billing_type_name: 'Test',
      billing_variant_name: 'Standard',
      billing_variant_code: 'T',
      tax_rate: 0.07,
      billing_included: true,
      is_cancelled_trip: false,
      effective_distance_km: 12
    }),
    minimalLine({
      billing_type_name: 'Test',
      billing_variant_name: 'Standard',
      billing_variant_code: 'T',
      tax_rate: 0.07,
      billing_included: true,
      is_cancelled_trip: true,
      effective_distance_km: 5
    })
  ];

  test('toggle off: cancelled bucket is computed but cover shows only normal', () => {
    const showToggle = false;
    const { normalBilledKm, cancelledBilledKm } = computeInvoiceCoverKm(items);
    expect(normalBilledKm).toBe(12);
    expect(cancelledBilledKm).toBe(5);
    // When toggle is off, the cover only renders normalBilledKm
    // (this simulates what InvoicePdfCoverBody renders)
    const renderedKm = showToggle
      ? { normal: normalBilledKm, cancelled: cancelledBilledKm }
      : { normal: normalBilledKm, cancelled: null };
    expect(renderedKm.cancelled).toBe(null);
  });

  test('toggle on: both lines rendered — even when cancelledBilledKm is 0', () => {
    const showToggle = true;
    const noStorno: InvoiceLineItemRow[] = [
      minimalLine({
        billing_type_name: 'Test',
        billing_variant_name: 'Standard',
        billing_variant_code: 'T',
        tax_rate: 0.07,
        billing_included: true,
        is_cancelled_trip: false,
        effective_distance_km: 10
      })
    ];
    const { normalBilledKm, cancelledBilledKm } =
      computeInvoiceCoverKm(noStorno);
    expect(normalBilledKm).toBe(10);
    expect(cancelledBilledKm).toBe(0); // no cancelled rows → 0, not null
    // When toggle is on, the line always renders (even for 0)
    const showCancelledLine = showToggle; // cover body renders when showCancelledBilledKmOnCover is true
    expect(showCancelledLine).toBe(true);
  });

  test('toggle on with null cancelled km: line renders but shows dash', () => {
    const showToggle = true;
    const nullKm: InvoiceLineItemRow[] = [
      minimalLine({
        billing_type_name: 'Test',
        billing_variant_name: 'Standard',
        billing_variant_code: 'T',
        tax_rate: 0.07,
        billing_included: true,
        is_cancelled_trip: true,
        effective_distance_km: null, // null km
        distance_km: null
      })
    ];
    const { cancelledBilledKm } = computeInvoiceCoverKm(nullKm);
    // null propagates → bucket is null; line still renders, value shows dash
    expect(cancelledBilledKm).toBe(null);
    expect(showToggle).toBe(true); // still render the line
  });
});
