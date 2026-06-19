/**
 * Focused tests for recurring-rule station propagation.
 *
 * Covers three layers:
 *   1. `deriveStationsForTrip`  — pure generator helper (outbound vs return swap)
 *   2. `buildRecurringRulePayload` — station normalization (trim / empty → null)
 *   3. `validateRecurringRuleStationFields` — payer-gated submit-time validation
 *
 * All tests are narrow and deterministic — no Supabase client, no geocoding.
 */

import { describe, expect, test } from 'bun:test';
import { deriveStationsForTrip } from '@/lib/recurring-trip-generator';
import { buildRecurringRulePayload } from '@/features/clients/lib/build-recurring-rule-payload';
import {
  validateRecurringRuleStationFields,
  RECURRING_RULE_STATION_AT_LEAST_ONE_ERROR
} from '@/features/clients/components/recurring-rule-form-body';
import type { PayerOption } from '@/features/trips/types/trip-form-reference.types';
import type { RuleFormValues } from '@/features/clients/components/recurring-rule-form-body';

// ─── deriveStationsForTrip ────────────────────────────────────────────────────

describe('deriveStationsForTrip — outbound', () => {
  test('copies rule stations directly for outbound trip', () => {
    const result = deriveStationsForTrip(
      { pickup_station: 'Mitte', dropoff_station: 'Nord' },
      false
    );
    expect(result.pickup_station).toBe('Mitte');
    expect(result.dropoff_station).toBe('Nord');
  });

  test('null rule stations yield null on outbound trip', () => {
    const result = deriveStationsForTrip(
      { pickup_station: null, dropoff_station: null },
      false
    );
    expect(result.pickup_station).toBeNull();
    expect(result.dropoff_station).toBeNull();
  });

  test('mixed null/value on outbound — each side independent', () => {
    const result = deriveStationsForTrip(
      { pickup_station: 'Ost', dropoff_station: null },
      false
    );
    expect(result.pickup_station).toBe('Ost');
    expect(result.dropoff_station).toBeNull();
  });
});

describe('deriveStationsForTrip — return trip (swap)', () => {
  test('swaps stations: pickup_station ← rule.dropoff_station', () => {
    const result = deriveStationsForTrip(
      { pickup_station: 'Mitte', dropoff_station: 'Nord' },
      true
    );
    expect(result.pickup_station).toBe('Nord');
    expect(result.dropoff_station).toBe('Mitte');
  });

  test('null rule stations yield null on return trip (no swap artifacts)', () => {
    const result = deriveStationsForTrip(
      { pickup_station: null, dropoff_station: null },
      true
    );
    expect(result.pickup_station).toBeNull();
    expect(result.dropoff_station).toBeNull();
  });

  test('partial null swaps correctly — only non-null side survives', () => {
    const result = deriveStationsForTrip(
      { pickup_station: 'Süd', dropoff_station: null },
      true
    );
    // return: pickup gets rule.dropoff (null), dropoff gets rule.pickup ('Süd')
    expect(result.pickup_station).toBeNull();
    expect(result.dropoff_station).toBe('Süd');
  });
});

// ─── buildRecurringRulePayload — station normalization ────────────────────────

/** Minimal context object — only the fields touched by station normalization are relevant. */
const minimalCtx = {
  clientId: 'client-1',
  payers: [],
  billingTypes: []
};

/** Base form values — only station-relevant fields tested here. */
const baseFormValues: RuleFormValues = {
  days: ['MO'],
  payer_id: '',
  billing_variant_id: '',
  kts_document_applies: false,
  kts_manual: false,
  no_invoice_required: false,
  no_invoice_manual: false,
  fremdfirma_enabled: false,
  fremdfirma_id: '',
  fremdfirma_payment_mode: null,
  fremdfirma_cost: '',
  pickup_time: '',
  pickup_address: 'Hauptstraße 1, 10115 Berlin',
  dropoff_address: 'Nebenstraße 2, 10117 Berlin',
  pickup_station: '',
  dropoff_station: '',
  return_mode: 'none',
  return_time: '',
  start_date: '2026-01-01',
  end_date: '',
  is_active: true
};

describe('buildRecurringRulePayload — station normalization', () => {
  test('trims whitespace from station values', () => {
    const payload = buildRecurringRulePayload(
      {
        ...baseFormValues,
        pickup_station: '  Mitte  ',
        dropoff_station: ' Nord '
      },
      minimalCtx
    );
    expect(payload.pickup_station).toBe('Mitte');
    expect(payload.dropoff_station).toBe('Nord');
  });

  test('empty string persists as null (no empty-string persistence)', () => {
    const payload = buildRecurringRulePayload(
      { ...baseFormValues, pickup_station: '', dropoff_station: '' },
      minimalCtx
    );
    expect(payload.pickup_station).toBeNull();
    expect(payload.dropoff_station).toBeNull();
  });

  test('whitespace-only string persists as null', () => {
    const payload = buildRecurringRulePayload(
      { ...baseFormValues, pickup_station: '   ', dropoff_station: '  ' },
      minimalCtx
    );
    expect(payload.pickup_station).toBeNull();
    expect(payload.dropoff_station).toBeNull();
  });

  test('undefined station values persist as null (payer gate off, no field rendered)', () => {
    const payload = buildRecurringRulePayload(
      {
        ...baseFormValues,
        pickup_station: undefined,
        dropoff_station: undefined
      },
      minimalCtx
    );
    expect(payload.pickup_station).toBeNull();
    expect(payload.dropoff_station).toBeNull();
  });
});

// ─── validateRecurringRuleStationFields ───────────────────────────────────────

function makePayerOption(id: string, stationsEnabled: boolean): PayerOption {
  return {
    id,
    name: 'Test Payer',
    kts_default: null,
    no_invoice_required_default: null,
    reha_schein_enabled: false,
    recurring_rules_station_enabled: stationsEnabled
  };
}

const baseValues: RuleFormValues = {
  ...baseFormValues,
  payer_id: 'payer-1'
};

describe('validateRecurringRuleStationFields', () => {
  test('returns null when payer gate is off (no validation)', () => {
    const payers = [makePayerOption('payer-1', false)];
    const result = validateRecurringRuleStationFields(
      { ...baseValues, pickup_station: '', dropoff_station: '' },
      payers
    );
    expect(result).toBeNull();
  });

  test('returns null when no payer is selected', () => {
    const payers = [makePayerOption('payer-1', true)];
    const result = validateRecurringRuleStationFields(
      { ...baseValues, payer_id: '' },
      payers
    );
    expect(result).toBeNull();
  });

  test('both empty → fails with error on pickup_station only', () => {
    const payers = [makePayerOption('payer-1', true)];
    const result = validateRecurringRuleStationFields(
      { ...baseValues, pickup_station: '', dropoff_station: '' },
      payers
    );
    expect(result).toEqual({
      pickup_station: RECURRING_RULE_STATION_AT_LEAST_ONE_ERROR
    });
    expect(result?.dropoff_station).toBeUndefined();
  });

  test('only pickup_station filled → passes', () => {
    const payers = [makePayerOption('payer-1', true)];
    const result = validateRecurringRuleStationFields(
      { ...baseValues, pickup_station: 'Mitte', dropoff_station: '' },
      payers
    );
    expect(result).toBeNull();
  });

  test('only dropoff_station filled → passes', () => {
    const payers = [makePayerOption('payer-1', true)];
    const result = validateRecurringRuleStationFields(
      { ...baseValues, pickup_station: '', dropoff_station: 'Nord' },
      payers
    );
    expect(result).toBeNull();
  });

  test('both filled → passes', () => {
    const payers = [makePayerOption('payer-1', true)];
    const result = validateRecurringRuleStationFields(
      { ...baseValues, pickup_station: 'Mitte', dropoff_station: 'Nord' },
      payers
    );
    expect(result).toBeNull();
  });

  test('whitespace-only on both sides treated as empty → fails', () => {
    const payers = [makePayerOption('payer-1', true)];
    const result = validateRecurringRuleStationFields(
      { ...baseValues, pickup_station: '   ', dropoff_station: '  ' },
      payers
    );
    expect(result?.pickup_station).toBe(
      RECURRING_RULE_STATION_AT_LEAST_ONE_ERROR
    );
    expect(result?.dropoff_station).toBeUndefined();
  });

  test('whitespace-only pickup with filled dropoff → passes', () => {
    const payers = [makePayerOption('payer-1', true)];
    const result = validateRecurringRuleStationFields(
      { ...baseValues, pickup_station: '   ', dropoff_station: 'Nord' },
      payers
    );
    expect(result).toBeNull();
  });
});
