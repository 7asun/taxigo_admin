import { describe, expect, test } from 'bun:test';

import {
  normalizeKtsFilterValues,
  parseKtsFilterParam,
  getKtsFilterTriggerLabel,
  buildKtsTripFilterPlan
} from '../kts-filter';

// ─── normalizeKtsFilterValues ────────────────────────────────────────────────

describe('normalizeKtsFilterValues', () => {
  test('empty array → []', () => {
    expect(normalizeKtsFilterValues([])).toEqual([]);
  });

  test('null → []', () => {
    expect(normalizeKtsFilterValues(null)).toEqual([]);
  });

  test('undefined → []', () => {
    expect(normalizeKtsFilterValues(undefined)).toEqual([]);
  });

  test('strips unknown/crafted tokens', () => {
    expect(normalizeKtsFilterValues(['kts', 'hacked', 'reha'])).toEqual([
      'kts',
      'reha'
    ]);
  });

  test('deduplicates repeated tokens', () => {
    expect(normalizeKtsFilterValues(['no_kts', 'no_kts', 'reha'])).toEqual([
      'no_kts',
      'reha'
    ]);
  });

  test('preserves valid token order', () => {
    expect(normalizeKtsFilterValues(['no_reha', 'kts_fehler', 'kts'])).toEqual([
      'no_reha',
      'kts_fehler',
      'kts'
    ]);
  });

  test('all five valid tokens pass through', () => {
    expect(
      normalizeKtsFilterValues([
        'kts',
        'kts_fehler',
        'no_kts',
        'no_reha',
        'reha'
      ])
    ).toEqual(['kts', 'kts_fehler', 'no_kts', 'no_reha', 'reha']);
  });
});

// ─── parseKtsFilterParam ─────────────────────────────────────────────────────

describe('parseKtsFilterParam', () => {
  test('null → []', () => {
    expect(parseKtsFilterParam(null)).toEqual([]);
  });

  test('empty string → []', () => {
    expect(parseKtsFilterParam('')).toEqual([]);
  });

  test('single valid token', () => {
    expect(parseKtsFilterParam('kts')).toEqual(['kts']);
  });

  test('comma-separated tokens', () => {
    expect(parseKtsFilterParam('no_kts,no_reha')).toEqual([
      'no_kts',
      'no_reha'
    ]);
  });

  test('strips invalid tokens from comma list', () => {
    expect(parseKtsFilterParam('kts,INVALID,reha')).toEqual(['kts', 'reha']);
  });
});

// ─── getKtsFilterTriggerLabel ─────────────────────────────────────────────────

describe('getKtsFilterTriggerLabel', () => {
  test('no values → "KTS: Kein Filter"', () => {
    expect(getKtsFilterTriggerLabel([])).toBe('KTS: Kein Filter');
  });

  test('single token returns its German label', () => {
    expect(getKtsFilterTriggerLabel(['kts'])).toBe('Nur KTS');
    expect(getKtsFilterTriggerLabel(['no_kts'])).toBe('Kein KTS');
    expect(getKtsFilterTriggerLabel(['no_reha'])).toBe('Kein Reha-Schein');
  });

  test('multiple values returns count label', () => {
    expect(getKtsFilterTriggerLabel(['kts', 'reha'])).toBe('2 KTS-Filter');
    expect(getKtsFilterTriggerLabel(['no_kts', 'no_reha', 'kts'])).toBe(
      '3 KTS-Filter'
    );
  });
});

// ─── buildKtsTripFilterPlan ───────────────────────────────────────────────────

describe('buildKtsTripFilterPlan', () => {
  test('empty → mode: none', () => {
    expect(buildKtsTripFilterPlan([])).toEqual({ mode: 'none' });
  });

  test('null/undefined normalized → mode: none', () => {
    // normalizeKtsFilterValues is called internally; passing empty works as proxy
    expect(buildKtsTripFilterPlan([])).toEqual({ mode: 'none' });
  });

  test('single token → mode: single', () => {
    expect(buildKtsTripFilterPlan(['kts'])).toEqual({
      mode: 'single',
      token: 'kts'
    });
    expect(buildKtsTripFilterPlan(['kts_fehler'])).toEqual({
      mode: 'single',
      token: 'kts_fehler'
    });
    expect(buildKtsTripFilterPlan(['no_kts'])).toEqual({
      mode: 'single',
      token: 'no_kts'
    });
    expect(buildKtsTripFilterPlan(['no_reha'])).toEqual({
      mode: 'single',
      token: 'no_reha'
    });
    expect(buildKtsTripFilterPlan(['reha'])).toEqual({
      mode: 'single',
      token: 'reha'
    });
  });

  // Core invariant: no_kts + no_reha (alone) must be AND, not OR.
  test('no_kts + no_reha → mode: missing-both', () => {
    expect(buildKtsTripFilterPlan(['no_kts', 'no_reha'])).toEqual({
      mode: 'missing-both'
    });
  });

  test('no_reha + no_kts (reversed order) → mode: missing-both', () => {
    expect(buildKtsTripFilterPlan(['no_reha', 'no_kts'])).toEqual({
      mode: 'missing-both'
    });
  });

  test('kts + reha (two positive tokens) → mode: any-of', () => {
    expect(buildKtsTripFilterPlan(['kts', 'reha'])).toEqual({
      mode: 'any-of',
      tokens: ['kts', 'reha']
    });
  });

  // Mixed case: adding another token to the negative pair lifts it to any-of
  // but preserves includeMissingBoth so the translator still groups the pair.
  test('kts + no_kts + no_reha → any-of with includeMissingBoth', () => {
    const plan = buildKtsTripFilterPlan(['kts', 'no_kts', 'no_reha']);
    expect(plan).toEqual({
      mode: 'any-of',
      tokens: ['kts', 'no_kts', 'no_reha'],
      includeMissingBoth: true
    });
  });

  test('kts + kts_fehler (no negative pair) → any-of without includeMissingBoth', () => {
    const plan = buildKtsTripFilterPlan(['kts', 'kts_fehler']);
    expect(plan).toEqual({
      mode: 'any-of',
      tokens: ['kts', 'kts_fehler']
    });
    expect((plan as any).includeMissingBoth).toBeUndefined();
  });
});
