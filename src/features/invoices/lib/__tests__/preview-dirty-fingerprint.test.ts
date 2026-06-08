import { describe, expect, test } from 'bun:test';

import { buildPreviewDirtyFingerprint } from '@/features/invoices/lib/preview-dirty-fingerprint';
import { TAX_RATES } from '@/features/invoices/lib/tax-calculator';
import type {
  BuilderCancelledTripRow,
  BuilderLineItem,
  ExcludedTripRow
} from '@/features/invoices/types/invoice.types';
import type { PriceResolution } from '@/features/invoices/types/pricing.types';

const defaultResolution: PriceResolution = {
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
  overrides: Partial<BuilderLineItem> = {}
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
    price_resolution: defaultResolution,
    approach_fee_net: null,
    ...overrides
  };
}

const emptyCancelled: BuilderCancelledTripRow[] = [];
const emptyExcluded: ExcludedTripRow[] = [];

describe('buildPreviewDirtyFingerprint', () => {
  test('two identical calls return the same string', () => {
    const items = [minimalLineItem()];
    const a = buildPreviewDirtyFingerprint(
      items,
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    const b = buildPreviewDirtyFingerprint(
      items,
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  test('billingInclusion.included false → true changes signature', () => {
    const included = minimalLineItem({
      billingInclusion: { included: true, reason: '' }
    });
    const excluded = minimalLineItem({
      billingInclusion: { included: false, reason: 'Test' }
    });
    const sigIncluded = buildPreviewDirtyFingerprint(
      [included],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    const sigExcluded = buildPreviewDirtyFingerprint(
      [excluded],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    expect(sigIncluded).not.toBe(sigExcluded);
  });

  test('price_resolution.net change changes signature', () => {
    const base = minimalLineItem();
    const changed = minimalLineItem({
      price_resolution: { ...defaultResolution, net: 150 }
    });
    const sigBase = buildPreviewDirtyFingerprint(
      [base],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    const sigChanged = buildPreviewDirtyFingerprint(
      [changed],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    expect(sigBase).not.toBe(sigChanged);
  });

  test('price_resolution.gross change changes signature', () => {
    const base = minimalLineItem();
    const changed = minimalLineItem({
      price_resolution: { ...defaultResolution, gross: 200 }
    });
    const sigBase = buildPreviewDirtyFingerprint(
      [base],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    const sigChanged = buildPreviewDirtyFingerprint(
      [changed],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    expect(sigBase).not.toBe(sigChanged);
  });

  test('manualGrossTotal change changes signature', () => {
    const base = minimalLineItem();
    const changed = minimalLineItem({ manualGrossTotal: 250 });
    const sigBase = buildPreviewDirtyFingerprint(
      [base],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    const sigChanged = buildPreviewDirtyFingerprint(
      [changed],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    expect(sigBase).not.toBe(sigChanged);
  });

  test('effective_distance_km change changes signature', () => {
    const base = minimalLineItem();
    const changed = minimalLineItem({ effective_distance_km: 25 });
    const sigBase = buildPreviewDirtyFingerprint(
      [base],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    const sigChanged = buildPreviewDirtyFingerprint(
      [changed],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    expect(sigBase).not.toBe(sigChanged);
  });

  test('position change changes signature', () => {
    const base = minimalLineItem({ position: 1 });
    const changed = minimalLineItem({ position: 2 });
    const sigBase = buildPreviewDirtyFingerprint(
      [base],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    const sigChanged = buildPreviewDirtyFingerprint(
      [changed],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    expect(sigBase).not.toBe(sigChanged);
  });

  test('row removed from lineItems changes signature', () => {
    const a = minimalLineItem({ position: 1 });
    const b = minimalLineItem({ position: 2, trip_id: 'trip-2' });
    const sigTwo = buildPreviewDirtyFingerprint(
      [a, b],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    const sigOne = buildPreviewDirtyFingerprint(
      [a],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    expect(sigTwo).not.toBe(sigOne);
  });

  test('empty arrays return a stable non-empty string', () => {
    const sig = buildPreviewDirtyFingerprint(
      [],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    expect(sig).toBe('0_0_0_0');
    expect(sig.length).toBeGreaterThan(0);
  });

  test('ExcludedTripRow reason change changes signature', () => {
    const excludedA: ExcludedTripRow[] = [
      {
        line_date: '2026-06-15',
        client_name: 'Max',
        pickup_address: null,
        dropoff_address: null,
        billing_exclusion_reason: 'Reason A'
      }
    ];
    const excludedB: ExcludedTripRow[] = [
      {
        ...excludedA[0],
        billing_exclusion_reason: 'Reason B'
      }
    ];
    const sigA = buildPreviewDirtyFingerprint(
      [],
      emptyCancelled,
      emptyCancelled,
      excludedA
    );
    const sigB = buildPreviewDirtyFingerprint(
      [],
      emptyCancelled,
      emptyCancelled,
      excludedB
    );
    expect(sigA).not.toBe(sigB);
  });

  test('opted-out row with price_resolution.net change changes signature', () => {
    const optedOutLow = minimalLineItem({
      billingInclusion: { included: false, reason: 'Excluded' },
      price_resolution: { ...defaultResolution, net: 100 }
    });
    const optedOutHigh = minimalLineItem({
      billingInclusion: { included: false, reason: 'Excluded' },
      price_resolution: { ...defaultResolution, net: 200 }
    });
    const sigLow = buildPreviewDirtyFingerprint(
      [optedOutLow],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    const sigHigh = buildPreviewDirtyFingerprint(
      [optedOutHigh],
      emptyCancelled,
      emptyCancelled,
      emptyExcluded
    );
    expect(sigLow).not.toBe(sigHigh);
  });
});
