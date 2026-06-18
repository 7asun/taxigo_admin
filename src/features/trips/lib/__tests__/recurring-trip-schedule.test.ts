/**
 * Tests for recurring-trip-schedule helpers.
 *
 * Golden ISO assertions are literals (no computed expectations in the body).
 * All wall-clock ↔ UTC conversions assume Europe/Berlin (CEST = UTC+2 in summer,
 * CET = UTC+1 in winter) matching NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE default.
 */

import { describe, expect, test } from 'bun:test';

import {
  clockToHhMmSs,
  computeResyncScheduledAt,
  exceptionOriginalPickupTimeKey
} from '../recurring-trip-schedule';

// ─── clockToHhMmSs ───────────────────────────────────────────────────────────

describe('clockToHhMmSs', () => {
  test('HH:MM:SS passthrough', () => {
    expect(clockToHhMmSs('13:30:00')).toBe('13:30:00');
  });

  test('HH:MM padded to HH:MM:SS', () => {
    expect(clockToHhMmSs('13:30')).toBe('13:30:00');
  });

  test('leading-zero hours preserved', () => {
    expect(clockToHhMmSs('09:05:00')).toBe('09:05:00');
  });

  test('trims surrounding whitespace', () => {
    expect(clockToHhMmSs('  08:00  ')).toBe('08:00:00');
  });
});

// ─── computeResyncScheduledAt ─────────────────────────────────────────────────

describe('computeResyncScheduledAt — outbound legs', () => {
  test('outbound with pickup_time → correct Berlin ISO (CEST UTC+2)', () => {
    const result = computeResyncScheduledAt(
      { requested_date: '2026-06-20', link_type: 'outbound' },
      { pickup_time: '13:30:00', return_time: null, return_mode: 'none' }
    );
    // 13:30 Berlin CEST = 11:30 UTC
    expect(result).toBe('2026-06-20T11:30:00.000Z');
  });

  test('outbound with HH:MM pickup_time (no seconds) → correct UTC', () => {
    const result = computeResyncScheduledAt(
      { requested_date: '2026-06-20', link_type: null },
      { pickup_time: '13:30', return_time: null, return_mode: 'none' }
    );
    expect(result).toBe('2026-06-20T11:30:00.000Z');
  });

  test('timeless outbound (pickup_time null) → null', () => {
    const result = computeResyncScheduledAt(
      { requested_date: '2026-06-20', link_type: null },
      { pickup_time: null, return_time: '15:00:00', return_mode: 'exact' }
    );
    expect(result).toBe(null);
  });

  test('null link_type treated as outbound', () => {
    const result = computeResyncScheduledAt(
      { requested_date: '2026-01-15', link_type: null },
      { pickup_time: '10:00:00', return_time: null, return_mode: 'none' }
    );
    // 10:00 Berlin CET (winter) = 09:00 UTC
    expect(result).toBe('2026-01-15T09:00:00.000Z');
  });

  test('null requested_date → null regardless of time', () => {
    const result = computeResyncScheduledAt(
      { requested_date: null, link_type: 'outbound' },
      { pickup_time: '13:30:00', return_time: null, return_mode: 'none' }
    );
    expect(result).toBe(null);
  });
});

describe('computeResyncScheduledAt — return legs', () => {
  test('return leg exact mode → correct Berlin ISO', () => {
    const result = computeResyncScheduledAt(
      { requested_date: '2026-06-20', link_type: 'return' },
      { pickup_time: '13:30:00', return_time: '15:00:00', return_mode: 'exact' }
    );
    // 15:00 Berlin CEST = 13:00 UTC
    expect(result).toBe('2026-06-20T13:00:00.000Z');
  });

  test('return leg time_tbd → null (no fixed clock)', () => {
    const result = computeResyncScheduledAt(
      { requested_date: '2026-06-20', link_type: 'return' },
      { pickup_time: '13:30:00', return_time: null, return_mode: 'time_tbd' }
    );
    expect(result).toBe(null);
  });

  test('return leg none → null', () => {
    const result = computeResyncScheduledAt(
      { requested_date: '2026-06-20', link_type: 'return' },
      { pickup_time: '13:30:00', return_time: '15:00:00', return_mode: 'none' }
    );
    expect(result).toBe(null);
  });

  test('return leg exact with null return_time → null', () => {
    const result = computeResyncScheduledAt(
      { requested_date: '2026-06-20', link_type: 'return' },
      { pickup_time: '13:30:00', return_time: null, return_mode: 'exact' }
    );
    expect(result).toBe(null);
  });
});

// ─── exceptionOriginalPickupTimeKey — key direction is the critical invariant ─

describe('exceptionOriginalPickupTimeKey — key direction', () => {
  test('outbound: key uses priorRule.pickup_time (old time), NOT the new schedule', () => {
    const priorRule = {
      pickup_time: '13:45:00',
      return_time: null,
      return_mode: 'none'
    };
    const key = exceptionOriginalPickupTimeKey({ link_type: null }, priorRule);
    // Must equal old time
    expect(key).toBe('13:45:00');
    // Must NOT equal some hypothetical new schedule time
    expect(key).not.toBe('13:30:00');
  });

  test('outbound: HH:MM pickup_time normalised to HH:MM:SS in key', () => {
    const priorRule = {
      pickup_time: '13:45',
      return_time: null,
      return_mode: 'none'
    };
    expect(
      exceptionOriginalPickupTimeKey({ link_type: 'outbound' }, priorRule)
    ).toBe('13:45:00');
  });

  test('outbound timeless (pickup_time null) → null (no time-keyed exception possible)', () => {
    const priorRule = {
      pickup_time: null,
      return_time: null,
      return_mode: 'none'
    };
    expect(exceptionOriginalPickupTimeKey({ link_type: null }, priorRule)).toBe(
      null
    );
  });

  test('return time_tbd → sentinel 00:00:00', () => {
    const priorRule = {
      pickup_time: '13:45:00',
      return_time: null,
      return_mode: 'time_tbd'
    };
    expect(
      exceptionOriginalPickupTimeKey({ link_type: 'return' }, priorRule)
    ).toBe('00:00:00');
  });

  test('return exact → clockToHhMmSs(priorRule.return_time)', () => {
    const priorRule = {
      pickup_time: '10:00:00',
      return_time: '15:30:00',
      return_mode: 'exact'
    };
    expect(
      exceptionOriginalPickupTimeKey({ link_type: 'return' }, priorRule)
    ).toBe('15:30:00');
  });

  test('return exact normalises HH:MM return_time', () => {
    const priorRule = {
      pickup_time: '10:00:00',
      return_time: '15:30',
      return_mode: 'exact'
    };
    expect(
      exceptionOriginalPickupTimeKey({ link_type: 'return' }, priorRule)
    ).toBe('15:30:00');
  });

  test('return none → null (no valid exception key)', () => {
    const priorRule = {
      pickup_time: '10:00:00',
      return_time: null,
      return_mode: 'none'
    };
    expect(
      exceptionOriginalPickupTimeKey({ link_type: 'return' }, priorRule)
    ).toBe(null);
  });
});
