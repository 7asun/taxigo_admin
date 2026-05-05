import { describe, expect, test } from 'bun:test';

import type { InvoiceLineItemRow } from '@/features/invoices/types/invoice.types';
import {
  buildInvoicePdfGroupedByBillingType,
  groupLineItemsByBillingType,
  invoicePdfBillingCategoryLabel
} from '../build-invoice-pdf-summary';

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
      >
    >
): InvoiceLineItemRow {
  return {
    id: 'x',
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
    created_at: '2026-01-01',
    pricing_strategy_used: null,
    pricing_source: null,
    kts_override: partial.kts_override ?? false,
    price_resolution_snapshot: null
  };
}

describe('invoicePdfBillingCategoryLabel', () => {
  test('prefers Abrechnungsfamilie over Unterart „Standard“', () => {
    expect(
      invoicePdfBillingCategoryLabel({
        billing_type_name: 'Abreise',
        billing_variant_name: 'Standard',
        billing_variant_code: 'A1'
      })
    ).toBe('Abreise');
  });

  test('prefers Anreise when snapshotted', () => {
    expect(
      invoicePdfBillingCategoryLabel({
        billing_type_name: 'Anreise',
        billing_variant_name: 'Standard',
        billing_variant_code: 'B2'
      })
    ).toBe('Anreise');
  });

  test('legacy: null family falls back to variant name', () => {
    expect(
      invoicePdfBillingCategoryLabel({
        billing_type_name: null,
        billing_variant_name: 'Dialyse',
        billing_variant_code: 'D1'
      })
    ).toBe('Dialyse');
  });
});

describe('buildInvoicePdfGroupedByBillingType', () => {
  test('single-type invoice: groups by family name, not Standard variant', () => {
    const summary = buildInvoicePdfGroupedByBillingType([
      minimalLine({
        billing_type_name: 'Abreise',
        billing_variant_name: 'Standard',
        billing_variant_code: 'X',
        tax_rate: 0.07,
        position: 1
      }),
      minimalLine({
        billing_type_name: 'Abreise',
        billing_variant_name: 'Standard',
        billing_variant_code: 'X',
        tax_rate: 0.07,
        position: 2
      })
    ]);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.descriptionPrimary).toBe('Abreise');
    expect(summary[0]!.quantity).toBe(2);
  });

  test('multi-type invoice: separate rows per Abrechnungsfamilie', () => {
    const summary = buildInvoicePdfGroupedByBillingType([
      minimalLine({
        billing_type_name: 'Abreise',
        billing_variant_name: 'Standard',
        billing_variant_code: 'A',
        tax_rate: 0.07
      }),
      minimalLine({
        billing_type_name: 'Anreise',
        billing_variant_name: 'Standard',
        billing_variant_code: 'B',
        tax_rate: 0.07
      })
    ]);
    expect(summary).toHaveLength(2);
    const labels = summary.map((s) => s.descriptionPrimary).sort();
    expect(labels).toEqual(['Abreise', 'Anreise']);
  });
});

describe('groupLineItemsByBillingType', () => {
  test('appendix groups use same family label', () => {
    const groups = groupLineItemsByBillingType([
      minimalLine({
        billing_type_name: 'Anreise',
        billing_variant_name: 'Standard',
        billing_variant_code: 'Z',
        tax_rate: 0.19
      })
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('Anreise');
    expect(groups[0]!.items).toHaveLength(1);
  });
});
