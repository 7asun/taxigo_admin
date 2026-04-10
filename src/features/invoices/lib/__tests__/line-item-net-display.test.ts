import { describe, expect, test } from 'bun:test';

import {
  lineItemNetAmountForDisplay,
  unitNetFromEditedLineNet
} from '@/features/invoices/lib/line-item-net-display';
import type { BuilderLineItem } from '@/features/invoices/types/invoice.types';

function tieredItem(overrides: Partial<BuilderLineItem> = {}): BuilderLineItem {
  const net = 35;
  const qty = 15;
  const unitPerKm = Math.round((net / qty) * 100) / 100;
  return {
    trip_id: 't1',
    position: 1,
    line_date: null,
    description: 'Test',
    client_name: null,
    pickup_address: null,
    dropoff_address: null,
    distance_km: qty,
    unit_price: unitPerKm,
    quantity: qty,
    tax_rate: 0.07,
    billing_variant_code: null,
    billing_variant_name: null,
    kts_document_applies: false,
    no_invoice_warning: false,
    price_resolution: {
      gross: null,
      net,
      tax_rate: 0.07,
      strategy_used: 'tiered_km',
      source: 'variant',
      unit_price_net: unitPerKm,
      quantity: qty
    },
    kts_override: false,
    trip_meta: null,
    price_source: null,
    warnings: [],
    ...overrides
  };
}

describe('lineItemNetAmountForDisplay', () => {
  test('15 km tiered: shows line net €35, not per-km unit', () => {
    expect(lineItemNetAmountForDisplay(tieredItem())).toBe(35);
  });

  test('quantity 1: shows unit_price as line net', () => {
    const item = tieredItem({
      quantity: 1,
      unit_price: 42.5,
      price_resolution: {
        gross: null,
        net: 42.5,
        tax_rate: 0.07,
        strategy_used: 'client_price_tag',
        source: 'client_price_tag',
        unit_price_net: 42.5,
        quantity: 1
      }
    });
    expect(lineItemNetAmountForDisplay(item)).toBe(42.5);
  });

  test('null unit_price → null', () => {
    const item = tieredItem({ unit_price: null });
    expect(lineItemNetAmountForDisplay(item)).toBeNull();
  });
});

describe('unitNetFromEditedLineNet', () => {
  test('divides edited line net by km quantity', () => {
    const item = tieredItem();
    expect(unitNetFromEditedLineNet(item, 35)).toBeCloseTo(2.33, 2);
  });

  test('quantity 1: passes through edited value', () => {
    const item = tieredItem({ quantity: 1 });
    expect(unitNetFromEditedLineNet(item, 99)).toBe(99);
  });
});
