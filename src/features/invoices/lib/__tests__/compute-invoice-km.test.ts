import { describe, expect, test } from 'bun:test';

import {
  computeInvoiceKmBuckets,
  computeInvoiceCoverKm,
  computeInvoiceLineKm,
  DEFAULT_SHOW_CANCELLED_BILLED_KM_ON_COVER,
  type InvoiceKmLineItem
} from '@/features/invoices/lib/compute-invoice-km';

// ─── helpers ─────────────────────────────────────────────────────────────────

function row(
  opts: {
    effective?: number | null;
    distance?: number | null;
    included?: boolean | null;
    cancelled?: boolean | null;
  } = {}
): InvoiceKmLineItem {
  return {
    effective_distance_km: opts.effective ?? null,
    distance_km: opts.distance ?? null,
    billing_included: opts.included ?? true, // default: included
    is_cancelled_trip: opts.cancelled ?? false
  };
}

// ─── computeInvoiceLineKm ────────────────────────────────────────────────────

describe('computeInvoiceLineKm', () => {
  test('uses effective_distance_km when set', () => {
    expect(computeInvoiceLineKm(row({ effective: 12.5, distance: 10 }))).toBe(
      12.5
    );
  });

  test('falls back to distance_km when effective is null', () => {
    expect(computeInvoiceLineKm(row({ effective: null, distance: 8.3 }))).toBe(
      8.3
    );
  });

  test('falls back to distance_km when effective is undefined', () => {
    const item: InvoiceKmLineItem = { distance_km: 5 };
    expect(computeInvoiceLineKm(item)).toBe(5);
  });

  test('returns null when both fields are null', () => {
    expect(computeInvoiceLineKm(row({ effective: null, distance: null }))).toBe(
      null
    );
  });

  test('returns null when both fields are missing', () => {
    expect(computeInvoiceLineKm({})).toBe(null);
  });

  test('zero distance returns 0, not null', () => {
    expect(computeInvoiceLineKm(row({ effective: 0 }))).toBe(0);
  });
});

// ─── computeInvoiceKmBuckets — normal bucket ────────────────────────────────

describe('computeInvoiceKmBuckets — normal bucket', () => {
  test('sums billing-included non-cancelled rows', () => {
    const items = [
      row({ effective: 10, included: true, cancelled: false }),
      row({ effective: 20, included: true, cancelled: false })
    ];
    expect(computeInvoiceKmBuckets(items).normalBilledKm).toBe(30);
  });

  test('excludes billing_included = false rows (K4)', () => {
    const items = [
      row({ effective: 10, included: true, cancelled: false }),
      row({ effective: 99, included: false, cancelled: false })
    ];
    expect(computeInvoiceKmBuckets(items).normalBilledKm).toBe(10);
  });

  test('excludes cancelled rows from normal bucket (K3)', () => {
    const items = [
      row({ effective: 15, included: true, cancelled: false }),
      row({ effective: 50, included: true, cancelled: true })
    ];
    expect(computeInvoiceKmBuckets(items).normalBilledKm).toBe(15);
  });

  test('returns 0 for empty input', () => {
    expect(computeInvoiceKmBuckets([]).normalBilledKm).toBe(0);
  });

  test('null propagation — any null km makes bucket null (K6)', () => {
    const items = [
      row({ effective: 10, included: true, cancelled: false }),
      row({ effective: null, distance: null, included: true, cancelled: false })
    ];
    expect(computeInvoiceKmBuckets(items).normalBilledKm).toBe(null);
  });

  test('legacy row with billing_included undefined treated as included', () => {
    const item: InvoiceKmLineItem = {
      effective_distance_km: 7,
      billing_included: undefined,
      is_cancelled_trip: false
    };
    expect(computeInvoiceKmBuckets([item]).normalBilledKm).toBe(7);
  });

  test('legacy row with billing_included null treated as included', () => {
    const item: InvoiceKmLineItem = {
      effective_distance_km: 4,
      billing_included: null,
      is_cancelled_trip: false
    };
    expect(computeInvoiceKmBuckets([item]).normalBilledKm).toBe(4);
  });

  test('is_cancelled_trip null treated as normal (not cancelled)', () => {
    const item: InvoiceKmLineItem = {
      effective_distance_km: 6,
      billing_included: true,
      is_cancelled_trip: null
    };
    expect(computeInvoiceKmBuckets([item]).normalBilledKm).toBe(6);
  });

  test('uses distance_km fallback for normal rows', () => {
    const items = [
      { distance_km: 11, billing_included: true, is_cancelled_trip: false }
    ];
    expect(computeInvoiceKmBuckets(items).normalBilledKm).toBe(11);
  });
});

// ─── computeInvoiceKmBuckets — cancelled bucket ─────────────────────────────

describe('computeInvoiceKmBuckets — cancelled bucket', () => {
  test('sums billing-included cancelled rows', () => {
    const items = [
      row({ effective: 5, included: true, cancelled: true }),
      row({ effective: 8, included: true, cancelled: true })
    ];
    expect(computeInvoiceKmBuckets(items).cancelledBilledKm).toBe(13);
  });

  test('excludes opted-out cancelled rows (K4)', () => {
    const items = [
      row({ effective: 5, included: true, cancelled: true }),
      row({ effective: 99, included: false, cancelled: true })
    ];
    expect(computeInvoiceKmBuckets(items).cancelledBilledKm).toBe(5);
  });

  test('returns 0 when no cancelled rows', () => {
    const items = [row({ effective: 10, included: true, cancelled: false })];
    expect(computeInvoiceKmBuckets(items).cancelledBilledKm).toBe(0);
  });

  test('null propagation on cancelled bucket', () => {
    const items = [
      row({ effective: 5, included: true, cancelled: true }),
      row({
        effective: null,
        distance: null,
        included: true,
        cancelled: true
      })
    ];
    expect(computeInvoiceKmBuckets(items).cancelledBilledKm).toBe(null);
  });

  test('uses distance_km fallback for cancelled rows', () => {
    const item: InvoiceKmLineItem = {
      distance_km: 9,
      billing_included: true,
      is_cancelled_trip: true
    };
    expect(computeInvoiceKmBuckets([item]).cancelledBilledKm).toBe(9);
  });
});

// ─── computeInvoiceKmBuckets — mixed ────────────────────────────────────────

describe('computeInvoiceKmBuckets — mixed inputs', () => {
  test('correctly partitions mixed array', () => {
    const items = [
      row({ effective: 10, included: true, cancelled: false }), // normal
      row({ effective: 20, included: true, cancelled: true }), // cancelled-billed
      row({ effective: 99, included: false, cancelled: false }), // excluded
      row({ effective: 5, included: true, cancelled: false }) // normal
    ];
    const { normalBilledKm, cancelledBilledKm } =
      computeInvoiceKmBuckets(items);
    expect(normalBilledKm).toBe(15);
    expect(cancelledBilledKm).toBe(20);
  });

  test('null in normal bucket does not affect cancelled bucket', () => {
    const items = [
      row({
        effective: null,
        distance: null,
        included: true,
        cancelled: false
      }),
      row({ effective: 7, included: true, cancelled: true })
    ];
    const { normalBilledKm, cancelledBilledKm } =
      computeInvoiceKmBuckets(items);
    expect(normalBilledKm).toBe(null);
    expect(cancelledBilledKm).toBe(7);
  });

  test('rounding applied on sums', () => {
    const items = [
      row({ effective: 1.005, included: true, cancelled: false }),
      row({ effective: 2.005, included: true, cancelled: false })
    ];
    // 3.01 rounds to 3.01
    const { normalBilledKm } = computeInvoiceKmBuckets(items);
    expect(typeof normalBilledKm).toBe('number');
    expect(normalBilledKm).not.toBeNull();
  });
});

// ─── computeInvoiceCoverKm ───────────────────────────────────────────────────

describe('computeInvoiceCoverKm', () => {
  test('is identical to computeInvoiceKmBuckets', () => {
    const items = [
      row({ effective: 10, included: true, cancelled: false }),
      row({ effective: 5, included: true, cancelled: true })
    ];
    expect(computeInvoiceCoverKm(items)).toEqual(
      computeInvoiceKmBuckets(items)
    );
  });
});

// ─── DEFAULT_SHOW_CANCELLED_BILLED_KM_ON_COVER ───────────────────────────────

describe('DEFAULT_SHOW_CANCELLED_BILLED_KM_ON_COVER', () => {
  test('is false by default (opt-in behaviour)', () => {
    expect(DEFAULT_SHOW_CANCELLED_BILLED_KM_ON_COVER).toBe(false);
  });
});
