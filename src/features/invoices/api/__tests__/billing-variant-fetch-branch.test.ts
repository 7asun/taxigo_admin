import { describe, expect, test } from 'bun:test';

import { billingVariantFetchBranchFromParams } from '@/features/invoices/api/invoice-line-items.api';
import { tripsBuilderParamsFromStep2 } from '@/features/invoices/lib/trips-builder-params';
import {
  normalizeTripsForBuilderTypeIdsForQueryKey,
  normalizeTripsForBuilderVariantIdsForQueryKey
} from '@/query/keys/invoices';

const T1 = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';
const V1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const V2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SINGLE_VAR = '33333333-3333-3333-3333-333333333333';

describe('billingVariantFetchBranchFromParams', () => {
  test('subset + single family from billing_type_ids takes precedence over billing_variant_id', () => {
    expect(
      billingVariantFetchBranchFromParams({
        billing_type_id: null,
        billing_type_ids: [T1],
        billing_variant_id: SINGLE_VAR,
        billing_variant_ids: [V1, V2]
      })
    ).toEqual({
      branch: 'subset',
      billingTypeId: T1,
      requestedIds: [V1, V2]
    });
  });

  test('subset + legacy billing_type_id when no billing_type_ids', () => {
    expect(
      billingVariantFetchBranchFromParams({
        billing_type_id: T1,
        billing_variant_id: SINGLE_VAR,
        billing_variant_ids: [V1, V2]
      })
    ).toEqual({
      branch: 'subset',
      billingTypeId: T1,
      requestedIds: [V1, V2]
    });
  });

  test('single variant when no non-empty subset', () => {
    expect(
      billingVariantFetchBranchFromParams({
        billing_type_id: T1,
        billing_variant_id: SINGLE_VAR,
        billing_variant_ids: null
      })
    ).toEqual({
      branch: 'single',
      variantId: SINGLE_VAR
    });
  });

  test('empty billing_variant_ids falls through to single or type', () => {
    expect(
      billingVariantFetchBranchFromParams({
        billing_type_id: T1,
        billing_variant_id: null,
        billing_variant_ids: []
      })
    ).toEqual({
      branch: 'allVariantsOfType',
      billingTypeId: T1
    });
  });

  test('all variants of type when type set and no subset or single', () => {
    expect(
      billingVariantFetchBranchFromParams({
        billing_type_id: T1,
        billing_variant_id: null,
        billing_variant_ids: null
      })
    ).toEqual({
      branch: 'allVariantsOfType',
      billingTypeId: T1
    });
  });

  test('multiTypes when billing_type_ids length > 1', () => {
    expect(
      billingVariantFetchBranchFromParams({
        billing_type_id: null,
        billing_type_ids: [T2, T1],
        billing_variant_id: null,
        billing_variant_ids: null
      })
    ).toEqual({
      branch: 'multiTypes',
      billingTypeIds: [T1, T2]
    });
  });

  test('allVariantsOfType when exactly one billing_type_ids', () => {
    expect(
      billingVariantFetchBranchFromParams({
        billing_type_id: null,
        billing_type_ids: [T1],
        billing_variant_id: null,
        billing_variant_ids: null
      })
    ).toEqual({
      branch: 'allVariantsOfType',
      billingTypeId: T1
    });
  });

  test('no variant filter when no type and no variants', () => {
    expect(
      billingVariantFetchBranchFromParams({
        billing_type_id: null,
        billing_variant_id: null,
        billing_variant_ids: null
      })
    ).toEqual({ branch: 'noVariantFilter' });
  });

  test('subset without single family is not emitted (falls through)', () => {
    expect(
      billingVariantFetchBranchFromParams({
        billing_type_id: null,
        billing_type_ids: [T1, T2],
        billing_variant_id: null,
        billing_variant_ids: [V1]
      })
    ).toEqual({
      branch: 'multiTypes',
      billingTypeIds: [T1, T2]
    });
  });

  test('subset without billing_type_id or billing_type_ids is not emitted', () => {
    expect(
      billingVariantFetchBranchFromParams({
        billing_type_id: null,
        billing_variant_id: null,
        billing_variant_ids: [V1]
      })
    ).toEqual({ branch: 'noVariantFilter' });
  });
});

describe('normalizeTripsForBuilderVariantIdsForQueryKey', () => {
  test('returns null for empty or missing', () => {
    expect(normalizeTripsForBuilderVariantIdsForQueryKey(null)).toBeNull();
    expect(normalizeTripsForBuilderVariantIdsForQueryKey(undefined)).toBeNull();
    expect(normalizeTripsForBuilderVariantIdsForQueryKey([])).toBeNull();
  });

  test('sorts ids so different order shares the same normalized key material', () => {
    const a = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const b = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const c = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    expect(normalizeTripsForBuilderVariantIdsForQueryKey([c, a, b])).toEqual([
      a,
      b,
      c
    ]);
    expect(normalizeTripsForBuilderVariantIdsForQueryKey([a, b, c])).toEqual([
      a,
      b,
      c
    ]);
  });
});

describe('normalizeTripsForBuilderTypeIdsForQueryKey', () => {
  test('returns null for empty or missing', () => {
    expect(normalizeTripsForBuilderTypeIdsForQueryKey(null)).toBeNull();
    expect(normalizeTripsForBuilderTypeIdsForQueryKey(undefined)).toBeNull();
    expect(normalizeTripsForBuilderTypeIdsForQueryKey([])).toBeNull();
  });

  test('sorts ids for stable cache keys', () => {
    expect(normalizeTripsForBuilderTypeIdsForQueryKey([T2, T1])).toEqual([
      T1,
      T2
    ]);
  });
});

describe('tripsBuilderParamsFromStep2', () => {
  const base = {
    payer_id: '00000000-0000-0000-0000-000000000099',
    period_from: '2026-01-01',
    period_to: '2026-01-31',
    client_id: null as string | null
  };

  test('monthly: clears billing_variant_ids when billing_type_ids length !== 1', () => {
    const p = tripsBuilderParamsFromStep2({
      ...base,
      mode: 'monthly',
      billing_type_id: null,
      billing_type_ids: [T1, T2],
      billing_variant_id: null,
      billing_variant_ids: [V1, V2]
    });
    expect(p.billing_variant_ids).toBeNull();
    expect(p.billing_variant_id).toBeNull();
  });

  test('monthly: keeps normalized subset when exactly one billing type', () => {
    const p = tripsBuilderParamsFromStep2({
      ...base,
      mode: 'monthly',
      billing_type_id: null,
      billing_type_ids: [T1],
      billing_variant_id: null,
      billing_variant_ids: [V2, V1]
    });
    expect(p.billing_variant_ids).toEqual([V1, V2]);
    expect(p.billing_type_ids).toEqual([T1]);
  });

  test('per_client: passes billing_variant_id and ignores billing_type_ids', () => {
    const p = tripsBuilderParamsFromStep2({
      ...base,
      mode: 'per_client',
      billing_type_id: T1,
      billing_type_ids: [T2],
      billing_variant_id: SINGLE_VAR,
      billing_variant_ids: [V1]
    });
    expect(p.billing_type_ids).toBeNull();
    expect(p.billing_variant_id).toBe(SINGLE_VAR);
    expect(p.billing_variant_ids).toBeNull();
  });
});
