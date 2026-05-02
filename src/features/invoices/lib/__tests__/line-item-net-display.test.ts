import { describe, expect, test } from 'bun:test';

import {
  lineItemGrossTotalForDisplay,
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
    billing_type_name: null,
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

describe('lineItemGrossTotalForDisplay', () => {
  test('with approach_fee_net: full-line brutto, not transport-only pr.gross', () => {
    const tax = 0.07;
    const transportNet = 12.78;
    const approachNet = 5.59;
    const transportOnlyGross = Math.round(transportNet * (1 + tax) * 100) / 100;
    const item = tieredItem({
      quantity: 1,
      unit_price: transportNet,
      approach_fee_net: approachNet,
      approach_fee_gross: Math.round(approachNet * (1 + tax) * 100) / 100,
      price_resolution: {
        gross: transportOnlyGross,
        net: transportNet,
        tax_rate: tax,
        strategy_used: 'trip_price_fallback',
        source: 'trip_price',
        unit_price_net: transportNet,
        quantity: 1,
        approach_fee_net: approachNet
      }
    });
    expect(transportOnlyGross).toBe(13.67);
    expect(lineItemGrossTotalForDisplay(item)).toBe(19.66);
  });

  test('manualGrossTotal wins over computed brutto', () => {
    const item = tieredItem({
      manualGrossTotal: 99.99,
      isManualOverride: true,
      unit_price: 10,
      approach_fee_net: 5
    });
    expect(lineItemGrossTotalForDisplay(item)).toBe(99.99);
  });

  test('null unit_price → null', () => {
    expect(
      lineItemGrossTotalForDisplay(tieredItem({ unit_price: null }))
    ).toBeNull();
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
