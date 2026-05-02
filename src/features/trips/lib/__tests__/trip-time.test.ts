/**
 * Canonical trip-time helpers — timezone encoding for trips.scheduled_at.
 *
 * Golden ISO assertions are literals (no computed expectations in the body).
 */

import { describe, expect, test } from 'bun:test';

import {
  TripTimeError,
  buildScheduledAt,
  buildScheduledAtOrNull,
  parseScheduledAt
} from '../trip-time';

describe('buildScheduledAt — CEST (summer UTC+2)', () => {
  test('10:00 wall → correct UTC instant (pins cron-style literal-UTC mistake)', () => {
    expect(buildScheduledAt('2026-06-15', '10:00')).toBe(
      '2026-06-15T08:00:00.000Z'
    );
    expect(buildScheduledAt('2026-06-15', '10:00')).not.toBe(
      '2026-06-15T10:00:00.000Z'
    );
  });

  test('seconds-padded input matches HH:mm result', () => {
    expect(buildScheduledAt('2026-06-15', '10:00:00')).toBe(
      '2026-06-15T08:00:00.000Z'
    );
  });

  test('23:30 stays on same Berlin calendar date (half-open semantics vs naive UTC mixes)', () => {
    expect(buildScheduledAt('2026-06-15', '23:30')).toBe(
      '2026-06-15T21:30:00.000Z'
    );
  });
});

describe('buildScheduledAt — CET (winter UTC+1)', () => {
  test('10:00 wall → UTC+1 offset from literal-UTC regression', () => {
    expect(buildScheduledAt('2026-01-15', '10:00')).toBe(
      '2026-01-15T09:00:00.000Z'
    );
    expect(buildScheduledAt('2026-01-15', '10:00')).not.toBe(
      '2026-01-15T10:00:00.000Z'
    );
  });

  test('23:30 wall', () => {
    expect(buildScheduledAt('2026-01-15', '23:30')).toBe(
      '2026-01-15T22:30:00.000Z'
    );
  });
});

describe('buildScheduledAt — DST transition edges (@date-fns/tz oracle)', () => {
  /**
   * 29 March 2026 (Europe/Berlin): clocks spring forward 02:00 → 03:00.
   * 01:30 is valid **before** the gap (still standard CET).
   * @date-fns/tz resolves this instant to 2026-03-29T00:30:00.000Z.
   */
  test('spring forward day — 01:30 pre-transition CET', () => {
    expect(buildScheduledAt('2026-03-29', '01:30')).toBe(
      '2026-03-29T00:30:00.000Z'
    );
  });

  /**
   * 25 October 2026 (Europe/Berlin): clocks fall back 03:00 CEST → 02:00 CET — local hour 02:30 occurs twice.
   * `startOfDay` + `setHours` in `@date-fns/tz` resolves this ambiguous wall clock to the later branch
   * (02:30 CET, UTC+1), i.e. 2026-10-25T01:30:00.000Z — pinned as the library oracle, not hand-waved.
   */
  test('fall back day — ambiguous 02:30 (@date-fns/tz oracle)', () => {
    expect(buildScheduledAt('2026-10-25', '02:30')).toBe(
      '2026-10-25T01:30:00.000Z'
    );
  });
});

describe('buildScheduledAt — errors', () => {
  test('invalid hm pattern', () => {
    expect(() => buildScheduledAt('2026-06-15', 'abc')).toThrow(TripTimeError);
  });

  test('invalid ymd', () => {
    expect(() => buildScheduledAt('not-a-date', '10:00')).toThrow(
      TripTimeError
    );
  });

  test('empty ymd', () => {
    expect(() => buildScheduledAt('', '10:00')).toThrow(TripTimeError);
  });

  test('empty hm', () => {
    expect(() => buildScheduledAt('2026-06-15', '')).toThrow(TripTimeError);
  });
});

describe('buildScheduledAtOrNull', () => {
  test('returns null when ymd absent', () => {
    expect(buildScheduledAtOrNull(null, '10:00')).toBeNull();
  });

  test('returns null when hm absent', () => {
    expect(buildScheduledAtOrNull('2026-06-15', null)).toBeNull();
  });

  test('returns null when ymd empty', () => {
    expect(buildScheduledAtOrNull('', '10:00')).toBeNull();
  });

  test('delegates to buildScheduledAt when complete', () => {
    expect(buildScheduledAtOrNull('2026-06-15', '10:00')).toBe(
      buildScheduledAt('2026-06-15', '10:00')
    );
  });
});

describe('parseScheduledAt', () => {
  test('CEST UTC instant shows 10:00 local', () => {
    expect(parseScheduledAt('2026-06-15T08:00:00.000Z')).toEqual({
      ymd: '2026-06-15',
      hm: '10:00'
    });
  });

  test('CET UTC instant shows 10:00 local', () => {
    expect(parseScheduledAt('2026-01-15T09:00:00.000Z')).toEqual({
      ymd: '2026-01-15',
      hm: '10:00'
    });
  });

  test('"Leon" production row — UTC 23:10 maps to Berlin next calendar day 01:10', () => {
    expect(parseScheduledAt('2026-04-03T23:10:00.000Z')).toEqual({
      ymd: '2026-04-04',
      hm: '01:10'
    });
  });
});

describe('round-trip buildScheduledAt → parseScheduledAt', () => {
  test('June 15 10:00', () => {
    const iso = buildScheduledAt('2026-06-15', '10:00');
    expect(parseScheduledAt(iso)).toEqual({
      ymd: '2026-06-15',
      hm: '10:00'
    });
  });

  test('January 15 23:30', () => {
    const iso = buildScheduledAt('2026-01-15', '23:30');
    expect(parseScheduledAt(iso)).toEqual({
      ymd: '2026-01-15',
      hm: '23:30'
    });
  });

  test('June 15 23:30', () => {
    const iso = buildScheduledAt('2026-06-15', '23:30');
    expect(parseScheduledAt(iso)).toEqual({
      ymd: '2026-06-15',
      hm: '23:30'
    });
  });
});
