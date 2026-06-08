import { describe, expect, test } from 'bun:test';

import {
  billingIncludedLineItems,
  isBillingIncludedRow,
  mainCoverLineItems
} from '@/features/invoices/lib/billing-inclusion';

describe('isBillingIncludedRow — persisted shape', () => {
  test('billing_included true', () => {
    expect(isBillingIncludedRow({ billing_included: true })).toBe(true);
  });

  test('billing_included false', () => {
    expect(isBillingIncludedRow({ billing_included: false })).toBe(false);
  });

  test('billing_included null (legacy row)', () => {
    expect(isBillingIncludedRow({ billing_included: null })).toBe(true);
  });

  test('billing_included undefined (legacy row)', () => {
    expect(isBillingIncludedRow({ billing_included: undefined })).toBe(true);
  });

  test('missing field (legacy row)', () => {
    expect(isBillingIncludedRow({})).toBe(true);
  });
});

describe('isBillingIncludedRow — builder shape', () => {
  test('included true', () => {
    expect(
      isBillingIncludedRow({
        billingInclusion: { included: true, reason: '' }
      })
    ).toBe(true);
  });

  test('included false with reason', () => {
    expect(
      isBillingIncludedRow({
        billingInclusion: { included: false, reason: 'Doppelfahrt' }
      })
    ).toBe(false);
  });
});

describe('billingIncludedLineItems', () => {
  test('mixed persisted array returns only included rows', () => {
    const rows = [
      { billing_included: true, id: 'a' },
      { billing_included: false, id: 'b' },
      { billing_included: undefined, id: 'c' }
    ];
    const result = billingIncludedLineItems(rows);
    expect(result.map((r) => r.id)).toEqual(['a', 'c']);
  });

  test('mixed builder array returns only included rows', () => {
    const rows = [
      { billingInclusion: { included: true, reason: '' }, id: 1 },
      { billingInclusion: { included: false, reason: 'x' }, id: 2 }
    ];
    const result = billingIncludedLineItems(rows);
    expect(result.map((r) => r.id)).toEqual([1]);
  });

  test('empty array → empty array', () => {
    expect(billingIncludedLineItems([])).toEqual([]);
  });

  test('all excluded → empty array', () => {
    expect(
      billingIncludedLineItems([
        { billing_included: false },
        { billing_included: false }
      ])
    ).toEqual([]);
  });
});

describe('mainCoverLineItems', () => {
  test('excludes opted-out normal trip', () => {
    const rows = [
      { billing_included: true, is_cancelled_trip: false, id: 'in' },
      { billing_included: false, is_cancelled_trip: false, id: 'out' }
    ];
    expect(mainCoverLineItems(rows).map((r) => r.id)).toEqual(['in']);
  });

  test('excludes opted-in cancelled trip', () => {
    const rows = [
      {
        billing_included: true,
        is_cancelled_trip: true,
        id: 'cancelled'
      }
    ];
    expect(mainCoverLineItems(rows)).toEqual([]);
  });

  test('includes normal billing-included trip', () => {
    const rows = [
      { billing_included: true, is_cancelled_trip: false, id: 'ok' }
    ];
    expect(mainCoverLineItems(rows).map((r) => r.id)).toEqual(['ok']);
  });

  test('is_cancelled_trip null treated as normal when billing included', () => {
    const rows = [{ billing_included: true, is_cancelled_trip: null, id: 'x' }];
    expect(mainCoverLineItems(rows).map((r) => r.id)).toEqual(['x']);
  });
});
