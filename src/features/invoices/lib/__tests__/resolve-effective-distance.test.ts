import { describe, expect, test } from 'bun:test';

import {
  resolveEffectiveDistanceKm,
  type ClientKmOverrideLike
} from '../resolve-effective-distance';

const base = {
  manualDistanceKm: null as number | null,
  drivingDistanceKm: 42 as number | null,
  clientId: 'client-1' as string | null,
  payerId: 'payer-1' as string | null,
  billingVariantId: null as string | null,
  clientKmOverrides: [] as ClientKmOverrideLike[]
};

describe('resolveEffectiveDistanceKm', () => {
  test('manualDistanceKm set → returns it, ignores overrides and Google value', () => {
    const overrides: ClientKmOverrideLike[] = [
      {
        client_id: 'client-1',
        payer_id: 'payer-1',
        distance_km: 9,
        is_active: true
      }
    ];
    expect(
      resolveEffectiveDistanceKm({
        ...base,
        manualDistanceKm: 12.5,
        drivingDistanceKm: 99,
        clientKmOverrides: overrides
      })
    ).toBe(12.5);
  });

  test('manualDistanceKm null, payer-scoped override exists → returns override', () => {
    const overrides: ClientKmOverrideLike[] = [
      {
        client_id: 'client-1',
        payer_id: 'payer-1',
        distance_km: 18,
        is_active: true
      }
    ];
    expect(
      resolveEffectiveDistanceKm({
        ...base,
        clientKmOverrides: overrides
      })
    ).toBe(18);
  });

  test('manualDistanceKm null, no payer-scoped override but global override exists → returns global', () => {
    const overrides: ClientKmOverrideLike[] = [
      {
        client_id: 'client-1',
        payer_id: null,
        distance_km: 25,
        is_active: true
      }
    ];
    expect(
      resolveEffectiveDistanceKm({
        ...base,
        clientKmOverrides: overrides
      })
    ).toBe(25);
  });

  test('manualDistanceKm null, payer-scoped override AND global override both exist → payer-scoped wins', () => {
    const overrides: ClientKmOverrideLike[] = [
      {
        client_id: 'client-1',
        payer_id: null,
        distance_km: 100,
        is_active: true
      },
      {
        client_id: 'client-1',
        payer_id: 'payer-1',
        distance_km: 33,
        is_active: true
      }
    ];
    expect(
      resolveEffectiveDistanceKm({
        ...base,
        clientKmOverrides: overrides
      })
    ).toBe(33);
  });

  test('manualDistanceKm null, override for different client → falls through to Google', () => {
    const overrides: ClientKmOverrideLike[] = [
      {
        client_id: 'other-client',
        payer_id: null,
        distance_km: 77,
        is_active: true
      }
    ];
    expect(
      resolveEffectiveDistanceKm({
        ...base,
        clientKmOverrides: overrides
      })
    ).toBe(42);
  });

  test('manualDistanceKm null, no overrides → returns drivingDistanceKm', () => {
    expect(resolveEffectiveDistanceKm({ ...base })).toBe(42);
  });

  test('all sources null → returns null', () => {
    expect(
      resolveEffectiveDistanceKm({
        ...base,
        drivingDistanceKm: null,
        clientId: null
      })
    ).toBeNull();
  });

  test('is_active = false override → ignored, falls through', () => {
    const overrides: ClientKmOverrideLike[] = [
      {
        client_id: 'client-1',
        payer_id: null,
        distance_km: 50,
        is_active: false
      }
    ];
    expect(
      resolveEffectiveDistanceKm({
        ...base,
        clientKmOverrides: overrides
      })
    ).toBe(42);
  });

  test('variant-scoped + payer match beats payer-wide row', () => {
    const overrides: ClientKmOverrideLike[] = [
      {
        client_id: 'client-1',
        payer_id: 'payer-1',
        billing_variant_id: null,
        distance_km: 10,
        is_active: true
      },
      {
        client_id: 'client-1',
        payer_id: 'payer-1',
        billing_variant_id: 'var-a',
        distance_km: 55,
        is_active: true
      }
    ];
    expect(
      resolveEffectiveDistanceKm({
        ...base,
        billingVariantId: 'var-a',
        clientKmOverrides: overrides
      })
    ).toBe(55);
  });

  test('variant-scoped row (any payer on row) beats payer-wide when trip has variant', () => {
    const overrides: ClientKmOverrideLike[] = [
      {
        client_id: 'client-1',
        payer_id: 'payer-1',
        billing_variant_id: null,
        distance_km: 10,
        is_active: true
      },
      {
        client_id: 'client-1',
        payer_id: null,
        billing_variant_id: 'var-b',
        distance_km: 88,
        is_active: true
      }
    ];
    expect(
      resolveEffectiveDistanceKm({
        ...base,
        billingVariantId: 'var-b',
        clientKmOverrides: overrides
      })
    ).toBe(88);
  });
});
