import { describe, expect, test } from 'bun:test';

import {
  calculateInvoiceTotals,
  cancelledTripToInsertRow,
  lineItemToInsertRow
} from '@/features/invoices/api/invoice-line-items.api';
import {
  mapLineItemRowToBuilderCancelledTrip,
  mapLineItemRowToBuilderLineItem
} from '@/features/invoices/utils/map-line-item-row-to-builder-line-item';
import type {
  BuilderCancelledTripRow,
  BuilderLineItem,
  InvoiceLineItemRow
} from '@/features/invoices/types/invoice.types';

/**
 * No-op round-trip tests for the draft re-open mapper.
 *
 * Strategy: start from a `BuilderLineItem` (as the create flow would build it),
 * persist it with the real `lineItemToInsertRow` to get a canonical row, map the
 * row back to a builder line, persist again, and assert the financial fields are
 * byte-identical. This proves a no-op edit never silently changes a line total.
 * Self-consistent by construction (the "stored" row comes from the same
 * persistence function the production code uses).
 */

const INVOICE_ID = 'inv-roundtrip';

/** Financial columns that must survive a no-op round-trip unchanged. */
const FINANCIAL_KEYS = [
  'total_price',
  'unit_price',
  'quantity',
  'tax_rate',
  'approach_fee_net',
  'price_resolution_snapshot',
  'billing_included',
  'billing_exclusion_reason',
  'is_cancelled_trip'
] as const;

/** Adds the DB-only columns the mapper tolerates but does not depend on. */
function asRow(insertRow: Record<string, unknown>): InvoiceLineItemRow {
  return {
    id: 'li-1',
    created_at: '2026-05-01T00:00:00.000Z',
    ...insertRow
  } as unknown as InvoiceLineItemRow;
}

function expectFinancialsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): void {
  for (const key of FINANCIAL_KEYS) {
    expect(b[key]).toEqual(a[key]);
  }
}

// ─── Normal line builder factory ──────────────────────────────────────────────

function makeBuilderLineItem(
  overrides: Partial<BuilderLineItem> = {}
): BuilderLineItem {
  const taxRate = 0.07;
  const transportNet = 41.55;
  const unitPerKm = 2.07;
  const qty = 20.1;
  const approach = 3.8;
  return {
    trip_id: 't-normal',
    position: 1,
    line_date: '2026-04-12T08:30:00.000Z',
    description: 'Fahrt vom 12.04.2026 – Max Mustermann',
    client_name: 'Max Mustermann',
    pickup_address: 'A-Str. 1',
    dropoff_address: 'B-Str. 2',
    distance_km: qty,
    effective_distance_km: qty,
    original_distance_km: qty,
    manual_km_enabled: false,
    unit_price: unitPerKm,
    approach_fee_net: approach,
    quantity: qty,
    tax_rate: taxRate,
    billing_variant_code: 'V01',
    billing_variant_name: 'Vollversorgung',
    billing_type_name: 'Krankenfahrt',
    kts_document_applies: false,
    no_invoice_warning: false,
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
    resolved_rule: null,
    kts_override: false,
    trip_meta: null,
    price_source: 'trip_price',
    warnings: [],
    billingInclusion: { included: true, reason: '' },
    approach_fee_gross: Math.round(approach * (1 + taxRate) * 100) / 100,
    ...overrides
  };
}

/**
 * Persist a builder line, map the row back, persist again. Asserts the
 * round-tripped insert row preserves all financial fields and that header
 * totals are unchanged by the re-open.
 */
function roundTripNormal(seed: BuilderLineItem): void {
  const row = asRow(lineItemToInsertRow(INVOICE_ID, seed));
  const rebuilt = mapLineItemRowToBuilderLineItem(row, {
    manualKmEnabled: seed.manual_km_enabled ?? false
  });
  const row2 = lineItemToInsertRow(INVOICE_ID, rebuilt);

  expectFinancialsEqual(row, row2);
  expect(calculateInvoiceTotals([rebuilt])).toEqual(
    calculateInvoiceTotals([seed])
  );
}

describe('mapLineItemRowToBuilderLineItem — no-op round-trip', () => {
  test('normal trip (tiered_km, per-km qty, approach fee)', () => {
    roundTripNormal(makeBuilderLineItem());
  });

  test('manual gross override (manualGrossTotal NOT reconstructed; net-anchor parity)', () => {
    // Build a gross-override line the way applyGrossOverrideToResolution would:
    // gross is the SSOT, transport net = (gross - approachGross) / (1 + rate).
    const taxRate = 0.19;
    const grossTotal = 50;
    const approachFeeGross = 0;
    const transportNet = (grossTotal - approachFeeGross) / (1 + taxRate);
    const seed = makeBuilderLineItem({
      trip_id: 't-manual-gross',
      tax_rate: taxRate,
      quantity: 1,
      unit_price: transportNet,
      approach_fee_net: 0,
      approach_fee_gross: 0,
      price_resolution: {
        gross: grossTotal,
        net: transportNet,
        tax_rate: taxRate,
        strategy_used: 'manual_trip_price',
        // why: source stays at the original scope (NOT client_price_tag), so the
        // line is net-anchored in calculateInvoiceTotals — matching the RPC.
        source: 'payer',
        unit_price_net: transportNet,
        quantity: 1,
        approach_fee_net: 0,
        note: 'Manuell überschrieben (Bruttoeingabe)'
      },
      // create-time override markers (present on the seed, gone after re-open):
      manualGrossTotal: grossTotal,
      manualApproachFeeGross: 0,
      isManualOverride: true
    });

    const row = asRow(lineItemToInsertRow(INVOICE_ID, seed));
    const rebuilt = mapLineItemRowToBuilderLineItem(row);

    // The mapper must NOT reconstruct the override markers (no note coupling).
    expect(rebuilt.manualGrossTotal).toBeNull();
    expect(rebuilt.isManualOverride).toBe(false);

    const row2 = lineItemToInsertRow(INVOICE_ID, rebuilt);
    expectFinancialsEqual(row, row2);

    // Header totals: net-anchor on re-open vs manualGrossTotal branch at create.
    // Documented D1: within ≤1 cent. (Exact for this single-rate fixture.)
    const before = calculateInvoiceTotals([seed]);
    const after = calculateInvoiceTotals([rebuilt]);
    expect(Math.abs(after.total - before.total)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(after.subtotal - before.subtotal)).toBeLessThanOrEqual(
      0.01
    );
    expect(Math.abs(after.taxAmount - before.taxAmount)).toBeLessThanOrEqual(
      0.01
    );
  });

  test('KM override (effective distance differs from routing original)', () => {
    const seed = makeBuilderLineItem({
      trip_id: 't-km',
      original_distance_km: 18,
      effective_distance_km: 22,
      distance_km: 18,
      isManualKmOverride: true,
      manualDistanceKm: 22
    });
    const row = asRow(lineItemToInsertRow(INVOICE_ID, seed));
    const rebuilt = mapLineItemRowToBuilderLineItem(row);
    // KM badge reconstructed for UI from the distance columns.
    expect(rebuilt.isManualKmOverride).toBe(true);
    expect(rebuilt.manualDistanceKm).toBe(22);
    roundTripNormal(seed);
  });

  test('billing excluded (opted-out row keeps reason; totals unchanged by map)', () => {
    const seed = makeBuilderLineItem({
      trip_id: 't-excluded',
      billingInclusion: { included: false, reason: 'Doppelt erfasst' }
    });
    const row = asRow(lineItemToInsertRow(INVOICE_ID, seed));
    expect(row.billing_included).toBe(false);
    expect(row.billing_exclusion_reason).toBe('Doppelt erfasst');

    const rebuilt = mapLineItemRowToBuilderLineItem(row);
    expect(rebuilt.billingInclusion).toEqual({
      included: false,
      reason: 'Doppelt erfasst'
    });
    const row2 = lineItemToInsertRow(INVOICE_ID, rebuilt);
    expectFinancialsEqual(row, row2);
  });

  test('manual line with no trip_id (manually entered net)', () => {
    const taxRate = 0.19;
    const net = 33.61;
    const seed = makeBuilderLineItem({
      trip_id: null,
      quantity: 1,
      unit_price: net,
      approach_fee_net: null,
      approach_fee_gross: null,
      distance_km: null,
      effective_distance_km: null,
      original_distance_km: null,
      tax_rate: taxRate,
      billing_variant_code: null,
      billing_variant_name: null,
      billing_type_name: null,
      price_resolution: {
        gross: Math.round(net * (1 + taxRate) * 100) / 100,
        net,
        tax_rate: taxRate,
        strategy_used: 'manual_trip_price',
        source: 'trip_price',
        unit_price_net: net,
        quantity: 1,
        approach_fee_net: null
      }
    });
    const row = asRow(lineItemToInsertRow(INVOICE_ID, seed));
    expect(row.trip_id).toBeNull();
    const rebuilt = mapLineItemRowToBuilderLineItem(row);
    expect(rebuilt.trip_id).toBeNull();
    const row2 = lineItemToInsertRow(INVOICE_ID, rebuilt);
    expectFinancialsEqual(row, row2);
    expect(calculateInvoiceTotals([rebuilt])).toEqual(
      calculateInvoiceTotals([seed])
    );
  });
});

// ─── Cancelled-trip round-trip ────────────────────────────────────────────────

function makeBuilderCancelledTrip(
  overrides: Partial<BuilderCancelledTripRow> = {}
): BuilderCancelledTripRow {
  const taxRate = 0.07;
  const transportNet = 28.04;
  const approach = 0;
  return {
    id: 't-cancelled',
    scheduled_at: '2026-04-15T10:00:00.000Z',
    pickup_address: 'C-Str. 3',
    dropoff_address: 'D-Str. 4',
    canceled_reason_notes: null,
    client: null,
    client_name: 'Erika Musterfrau',
    driving_distance_km: 12,
    effective_distance_km: 12,
    original_distance_km: 12,
    billingInclusion: { included: true, reason: 'Leerfahrt berechnet' },
    price_resolution: {
      gross: null,
      net: transportNet,
      tax_rate: taxRate,
      strategy_used: 'tiered_km',
      source: 'payer',
      unit_price_net: transportNet,
      quantity: 1,
      approach_fee_net: approach
    },
    resolved_rule: null,
    unit_price: transportNet,
    tax_rate: taxRate,
    quantity: 1,
    approach_fee_net: approach,
    approach_fee_gross: Math.round(approach * (1 + taxRate) * 100) / 100,
    kts_override: false,
    billing_variant_code: 'V02',
    billing_variant_name: 'Teilversorgung',
    billing_type_name: 'Krankenfahrt',
    includeApproachFee: true,
    ...overrides
  };
}

describe('mapLineItemRowToBuilderCancelledTrip — no-op round-trip', () => {
  test('cancelled trip opted into billing', () => {
    const seed = makeBuilderCancelledTrip();
    const row = asRow(cancelledTripToInsertRow(INVOICE_ID, seed, 7));
    expect(row.is_cancelled_trip).toBe(true);

    const rebuilt = mapLineItemRowToBuilderCancelledTrip(row);
    expect(rebuilt.billingInclusion.included).toBe(true);

    const row2 = cancelledTripToInsertRow(INVOICE_ID, rebuilt, 7);
    expectFinancialsEqual(row, row2);
  });
});
