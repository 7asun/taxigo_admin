import { describe, expect, test } from 'bun:test';

import { buildConfirmationDisplayRows } from '@/features/invoices/lib/build-confirmation-display-rows';
import { TAX_RATES } from '@/features/invoices/lib/tax-calculator';
import type {
  BuilderCancelledTripRow,
  BuilderLineItem
} from '@/features/invoices/types/invoice.types';
import type { PriceResolution } from '@/features/invoices/types/pricing.types';

const basePriceResolution: PriceResolution = {
  gross: 107,
  net: 100,
  tax_rate: TAX_RATES.REDUCED,
  strategy_used: 'manual_trip_price',
  source: 'manual_gross_price',
  unit_price_net: 100,
  quantity: 1,
  approach_fee_net: 0
};

function minimalLineItem(
  overrides: Partial<BuilderLineItem> & {
    price_resolution?: PriceResolution;
  } = {}
): BuilderLineItem {
  return {
    trip_id: 'trip-normal-1',
    position: 1,
    line_date: '2026-06-15T10:00:00.000Z',
    description: 'Fahrt vom 15.06.2026 – Max Mustermann',
    client_name: 'Max Mustermann',
    pickup_address: null,
    dropoff_address: null,
    distance_km: 10,
    effective_distance_km: 10,
    original_distance_km: 10,
    manual_km_enabled: false,
    unit_price: 100,
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
    price_resolution: basePriceResolution,
    ...overrides
  };
}

function minimalCancelledTrip(
  overrides: Partial<BuilderCancelledTripRow> = {}
): BuilderCancelledTripRow {
  return {
    id: 'cancelled-1',
    scheduled_at: '2026-06-20T14:00:00.000Z',
    pickup_address: null,
    dropoff_address: null,
    canceled_reason_notes: null,
    client_name: 'Anna Schmidt',
    billingInclusion: { included: true, reason: 'Storno abgerechnet' },
    price_resolution: basePriceResolution,
    ...overrides
  };
}

describe('buildConfirmationDisplayRows', () => {
  test('one included normal, no cancelled — returns 1 row, normal, position 1', () => {
    const rows = buildConfirmationDisplayRows([minimalLineItem()], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rowType).toBe('normal');
    expect(rows[0]?.position).toBe(1);
  });

  test('one opted-out normal, no cancelled — returns 0 rows', () => {
    const rows = buildConfirmationDisplayRows(
      [
        minimalLineItem({
          billingInclusion: { included: false, reason: 'Nicht abrechenbar' }
        })
      ],
      []
    );
    expect(rows).toHaveLength(0);
  });

  test('one included normal + one opted-in cancelled (priced) — 2 rows, positions 1 and 2', () => {
    const rows = buildConfirmationDisplayRows(
      [minimalLineItem()],
      [minimalCancelledTrip()]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.rowType).toBe('normal');
    expect(rows[0]?.position).toBe(1);
    expect(rows[1]?.rowType).toBe('cancelled');
    expect(rows[1]?.position).toBe(2);
  });

  test('one included normal + one opted-out cancelled — cancelled excluded', () => {
    const rows = buildConfirmationDisplayRows(
      [minimalLineItem()],
      [
        minimalCancelledTrip({
          billingInclusion: { included: false, reason: '' }
        })
      ]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rowType).toBe('normal');
  });

  test('one included normal + one opted-in cancelled with null price_resolution — cancelled excluded', () => {
    const rows = buildConfirmationDisplayRows(
      [minimalLineItem()],
      [
        minimalCancelledTrip({
          price_resolution: null
        })
      ]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rowType).toBe('normal');
  });

  test('empty lineItems + empty cancelledTrips — returns []', () => {
    expect(buildConfirmationDisplayRows([], [])).toEqual([]);
  });

  test('two included normals + one opted-in cancelled — positions 1, 2, 3', () => {
    const rows = buildConfirmationDisplayRows(
      [
        minimalLineItem({ trip_id: 't1', position: 1 }),
        minimalLineItem({ trip_id: 't2', position: 2 })
      ],
      [minimalCancelledTrip({ id: 'c1' })]
    );
    expect(rows.map((r) => r.position)).toEqual([1, 2, 3]);
  });

  test('opted-out normal with price change — still excluded (inclusion is the gate)', () => {
    const rows = buildConfirmationDisplayRows(
      [
        minimalLineItem({
          billingInclusion: { included: false, reason: 'Test' },
          unit_price: 999,
          price_resolution: { ...basePriceResolution, net: 999, gross: 1069.93 }
        })
      ],
      []
    );
    expect(rows).toHaveLength(0);
  });

  test('cancelled row description contains Stornogebühr', () => {
    const rows = buildConfirmationDisplayRows([], [minimalCancelledTrip()]);
    expect(rows[0]?.description).toContain('Stornogebühr');
    expect(rows[0]?.description).toContain('Anna Schmidt');
  });

  test('row keys are unique', () => {
    const rows = buildConfirmationDisplayRows(
      [
        minimalLineItem({ trip_id: 't1', position: 1 }),
        minimalLineItem({ trip_id: 't2', position: 2 })
      ],
      [minimalCancelledTrip({ id: 'c1' })]
    );
    const keys = rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
