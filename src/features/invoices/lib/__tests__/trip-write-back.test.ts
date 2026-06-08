import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test';

import {
  buildTripWriteBackPatch,
  executeTripWriteBack
} from '@/features/invoices/lib/trip-write-back';
import { TAX_RATES } from '@/features/invoices/lib/tax-calculator';
import type { BuilderLineItem } from '@/features/invoices/types/invoice.types';
import type { PriceResolution } from '@/features/invoices/types/pricing.types';
import { tripsService } from '@/features/trips/api/trips.service';

function baseItem(
  overrides: Partial<BuilderLineItem> & {
    price_resolution: PriceResolution;
  }
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
    ...overrides
  };
}

describe('buildTripWriteBackPatch', () => {
  const priceResolution: PriceResolution = {
    gross: 107,
    net: 100,
    tax_rate: TAX_RATES.REDUCED,
    strategy_used: 'manual_trip_price',
    source: 'manual_gross_price',
    unit_price_net: 100,
    quantity: 1,
    approach_fee_net: 0
  };

  test('(a) manual_tax_rate only when isManualTaxRateOverride is true', () => {
    const withoutOverride = buildTripWriteBackPatch(
      baseItem({ price_resolution: priceResolution })
    );
    expect(withoutOverride).not.toHaveProperty('manual_tax_rate');

    const withOverride = buildTripWriteBackPatch(
      baseItem({
        price_resolution: priceResolution,
        isManualTaxRateOverride: true,
        tax_rate: TAX_RATES.ZERO
      })
    );
    expect(withOverride.manual_tax_rate).toBe(TAX_RATES.ZERO);
  });

  test('(b) tax_rate is never a patch key', () => {
    const patch = buildTripWriteBackPatch(
      baseItem({
        price_resolution: priceResolution,
        isManualTaxRateOverride: true,
        tax_rate: TAX_RATES.STANDARD
      })
    );
    expect(patch).not.toHaveProperty('tax_rate');
  });

  test('(c) net_price is never a patch key', () => {
    const patch = buildTripWriteBackPatch(
      baseItem({ price_resolution: priceResolution })
    );
    expect(patch).not.toHaveProperty('net_price');
  });

  test('(d) driving_distance_km is never a patch key', () => {
    const patch = buildTripWriteBackPatch(
      baseItem({
        price_resolution: priceResolution,
        isManualKmOverride: true,
        manualDistanceKm: 42
      })
    );
    expect(patch).not.toHaveProperty('driving_distance_km');
    expect(patch.manual_distance_km).toBe(42);
  });
});

describe('executeTripWriteBack', () => {
  const priceResolution: PriceResolution = {
    gross: 107,
    net: 100,
    tax_rate: TAX_RATES.REDUCED,
    strategy_used: 'manual_trip_price',
    source: 'manual_gross_price',
    unit_price_net: 100,
    quantity: 1,
    approach_fee_net: 0
  };

  let updateTripMock: ReturnType<typeof mock>;

  beforeEach(() => {
    updateTripMock = mock(() => Promise.resolve({ id: 'trip-1' }));
    tripsService.updateTrip = updateTripMock as typeof tripsService.updateTrip;
  });

  afterEach(() => {
    updateTripMock.mockClear();
  });

  test('skips opted-out trips — updateTrip called only for billing-included rows with trip_id', async () => {
    const included = baseItem({
      trip_id: 'trip-included',
      price_resolution: priceResolution
    });
    const excluded = baseItem({
      trip_id: 'trip-excluded',
      price_resolution: priceResolution,
      billingInclusion: { included: false, reason: 'Test exclusion' }
    });
    const noTripId = baseItem({
      trip_id: null,
      price_resolution: priceResolution
    });

    await executeTripWriteBack([included, excluded, noTripId]);

    expect(updateTripMock).toHaveBeenCalledTimes(1);
    expect(updateTripMock).toHaveBeenCalledWith(
      'trip-included',
      buildTripWriteBackPatch(included)
    );
  });
});
