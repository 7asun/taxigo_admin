/**
 * derive-duplicate-schedules.test.ts
 *
 * Tests the schedule-mode × unit-kind decision contract for `deriveDuplicateSchedules`
 * in isolation (no Supabase, no I/O). All assertions operate on the returned
 * `DuplicateSchedulesResult` shapes.
 *
 * Cases: 5 single-leg + 3 pair-outbound + 7 pair-return = 15 total.
 */

import { describe, expect, test } from 'bun:test';

import { deriveDuplicateSchedules } from '../derive-duplicate-schedules';
import { instantToYmdInBusinessTz } from '../trip-business-date';
import type { Trip } from '@/features/trips/api/trips.service';

// ─── Shared constants ─────────────────────────────────────────────────────────

const TARGET_DATE_YMD = '2026-06-20';

// Source trip scheduled at 08:00 Berlin on 2026-06-10 (UTC 06:00 in summer)
const ORIG_OUT_ISO = '2026-06-10T06:00:00.000Z';
// Source return at 10:00 Berlin on same day (UTC 08:00)
const ORIG_RET_ISO = '2026-06-10T08:00:00.000Z';
const ORIG_DELTA_MS =
  new Date(ORIG_RET_ISO).getTime() - new Date(ORIG_OUT_ISO).getTime();

// New outbound on TARGET_DATE_YMD at 09:15 Berlin (UTC 07:15 in summer)
const NEW_OUT_ISO = '2026-06-20T07:15:00.000Z';
const NEW_OUT_MS = new Date(NEW_OUT_ISO).getTime();
const NEW_OUT_REQ_YMD = instantToYmdInBusinessTz(NEW_OUT_MS); // '2026-06-20'

// An explicit return ISO for detail per-leg tests
const EXPLICIT_RET_ISO = '2026-06-20T11:45:00.000Z';
const EXPLICIT_RET_MS = new Date(EXPLICIT_RET_ISO).getTime();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tripStub(options: {
  id: string;
  scheduled_at: string | null;
  requested_date?: string | null;
}): Trip {
  const { id, scheduled_at, requested_date = null } = options;
  return {
    id,
    company_id: 'co1',
    scheduled_at,
    requested_date,
    linked_trip_id: null,
    link_type: null,
    rule_id: null
  } as unknown as Trip;
}

const origOut = tripStub({ id: 'orig-out', scheduled_at: ORIG_OUT_ISO });
const origRet = tripStub({ id: 'orig-ret', scheduled_at: ORIG_RET_ISO });

// ─── Single unit tests (5 cases) ──────────────────────────────────────────────

describe('deriveDuplicateSchedules — single unit', () => {
  test('1. time_open → scheduled_at null, requested_date = targetDateYmd', () => {
    const result = deriveDuplicateSchedules(
      {
        ids: ['orig-out'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'time_open'
      },
      { kind: 'single', trip: origOut }
    );

    expect(result.outbound.scheduled_at).toBeNull();
    expect(result.outbound.requested_date).toBe(TARGET_DATE_YMD);
    expect(result.return).toBeUndefined();
  });

  test('2. preserve_original_time with timed source → preserves wall clock on target date', () => {
    const result = deriveDuplicateSchedules(
      {
        ids: ['orig-out'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'preserve_original_time'
      },
      { kind: 'single', trip: origOut }
    );

    // Should be non-null and on the target date
    expect(result.outbound.scheduled_at).not.toBeNull();
    expect(result.outbound.requested_date).toBe(TARGET_DATE_YMD);
    // Wall-clock hour should match the source (08:00 Berlin)
    const resultDate = new Date(result.outbound.scheduled_at!);
    // In Berlin summer UTC+2: 08:00 Berlin = 06:00 UTC
    expect(resultDate.getUTCHours()).toBe(6);
    expect(resultDate.getUTCMinutes()).toBe(0);
  });

  test('3. preserve_original_time with untimed source → open on target date', () => {
    const untimedTrip = tripStub({
      id: 'orig-untimed',
      scheduled_at: null,
      requested_date: '2026-06-10'
    });

    const result = deriveDuplicateSchedules(
      {
        ids: ['orig-untimed'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'preserve_original_time'
      },
      { kind: 'single', trip: untimedTrip }
    );

    expect(result.outbound.scheduled_at).toBeNull();
    expect(result.outbound.requested_date).toBe(TARGET_DATE_YMD);
  });

  test('4. unified_time with ISO → uses ISO + business-day requested_date', () => {
    const result = deriveDuplicateSchedules(
      {
        ids: ['orig-out'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'unified_time',
        unifiedScheduledAtIso: NEW_OUT_ISO
      },
      { kind: 'single', trip: origOut }
    );

    expect(result.outbound.scheduled_at).toBe(NEW_OUT_ISO);
    expect(result.outbound.requested_date).toBe(NEW_OUT_REQ_YMD);
  });

  test('5. unified_time without ISO → throws "Bitte eine Abholzeit festlegen."', () => {
    expect(() =>
      deriveDuplicateSchedules(
        {
          ids: ['orig-out'],
          targetDateYmd: TARGET_DATE_YMD,
          scheduleMode: 'unified_time'
          // unifiedScheduledAtIso intentionally omitted
        },
        { kind: 'single', trip: origOut }
      )
    ).toThrow('Bitte eine Abholzeit festlegen.');
  });
});

// ─── Pair unit — outbound tests (3 cases) ─────────────────────────────────────

describe('deriveDuplicateSchedules — pair outbound', () => {
  test('6. time_open outbound → open', () => {
    const result = deriveDuplicateSchedules(
      {
        ids: ['orig-out'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'time_open'
      },
      { kind: 'pair', outbound: origOut, ret: origRet }
    );

    expect(result.outbound.scheduled_at).toBeNull();
    expect(result.outbound.requested_date).toBe(TARGET_DATE_YMD);
  });

  test('7. preserve_original_time outbound → preserves source outbound time', () => {
    const result = deriveDuplicateSchedules(
      {
        ids: ['orig-out'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'preserve_original_time'
      },
      { kind: 'pair', outbound: origOut, ret: origRet }
    );

    expect(result.outbound.scheduled_at).not.toBeNull();
    expect(result.outbound.requested_date).toBe(TARGET_DATE_YMD);
    const resultDate = new Date(result.outbound.scheduled_at!);
    // Source at 08:00 Berlin = 06:00 UTC
    expect(resultDate.getUTCHours()).toBe(6);
    expect(resultDate.getUTCMinutes()).toBe(0);
  });

  test('8. unified_time + explicitPerLegUnifiedTimes + no outbound ISO → outbound open on targetDateYmd', () => {
    const result = deriveDuplicateSchedules(
      {
        ids: ['orig-out'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'unified_time',
        explicitPerLegUnifiedTimes: true
        // unifiedScheduledAtIso intentionally omitted
      },
      { kind: 'pair', outbound: origOut, ret: origRet }
    );

    expect(result.outbound.scheduled_at).toBeNull();
    expect(result.outbound.requested_date).toBe(TARGET_DATE_YMD);
  });
});

// ─── Pair unit — return tests (7 cases) ───────────────────────────────────────

describe('deriveDuplicateSchedules — pair return', () => {
  test('9. time_open → return open on targetDateYmd', () => {
    const result = deriveDuplicateSchedules(
      {
        ids: ['orig-out'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'time_open'
      },
      { kind: 'pair', outbound: origOut, ret: origRet }
    );

    expect(result.return).toBeDefined();
    expect(result.return!.scheduled_at).toBeNull();
    expect(result.return!.requested_date).toBe(TARGET_DATE_YMD);
  });

  test('10. preserve_original_time, source return without time → return open', () => {
    const untimedRet = tripStub({
      id: 'orig-ret-untimed',
      scheduled_at: null,
      requested_date: '2026-06-10'
    });

    const result = deriveDuplicateSchedules(
      {
        ids: ['orig-out'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'preserve_original_time'
      },
      { kind: 'pair', outbound: origOut, ret: untimedRet }
    );

    expect(result.return!.scheduled_at).toBeNull();
    expect(result.return!.requested_date).toBe(TARGET_DATE_YMD);
  });

  test('11. preserve_original_time, source return has time → preserved on target date', () => {
    const result = deriveDuplicateSchedules(
      {
        ids: ['orig-out'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'preserve_original_time'
      },
      { kind: 'pair', outbound: origOut, ret: origRet }
    );

    // Source return at 10:00 Berlin = 08:00 UTC
    expect(result.return!.scheduled_at).not.toBeNull();
    const retDate = new Date(result.return!.scheduled_at!);
    expect(retDate.getUTCHours()).toBe(8);
    expect(retDate.getUTCMinutes()).toBe(0);
    expect(result.return!.requested_date).toBe(TARGET_DATE_YMD);
  });

  test('12. unified_time + explicitPerLegUnifiedTimes + explicit return ISO → uses ISO exactly', () => {
    const result = deriveDuplicateSchedules(
      {
        ids: ['orig-out'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'unified_time',
        explicitPerLegUnifiedTimes: true,
        unifiedScheduledAtIso: NEW_OUT_ISO,
        unifiedReturnScheduledAtIso: EXPLICIT_RET_ISO
      },
      { kind: 'pair', outbound: origOut, ret: origRet }
    );

    expect(result.return!.scheduled_at).toBe(EXPLICIT_RET_ISO);
    expect(result.return!.requested_date).toBe(
      instantToYmdInBusinessTz(EXPLICIT_RET_MS)
    );
  });

  test('13. [Bug fix] explicitPerLegUnifiedTimes + return ISO absent + both legs timed → scheduled_at null, requested_date aligned to outbound business day', () => {
    const result = deriveDuplicateSchedules(
      {
        ids: ['orig-out'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'unified_time',
        explicitPerLegUnifiedTimes: true,
        unifiedScheduledAtIso: NEW_OUT_ISO
        // unifiedReturnScheduledAtIso intentionally omitted
      },
      { kind: 'pair', outbound: origOut, ret: origRet }
    );

    expect(result.return!.scheduled_at).toBeNull();
    // requested_date must align to outbound business day, not raw targetDateYmd necessarily
    expect(result.return!.requested_date).toBe(NEW_OUT_REQ_YMD);
  });

  test('14. [Bulk regression] no explicitPerLegUnifiedTimes, both source legs timed, single unified ISO → delta-computed return scheduled_at', () => {
    const result = deriveDuplicateSchedules(
      {
        ids: ['orig-out'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'unified_time',
        unifiedScheduledAtIso: NEW_OUT_ISO
        // explicitPerLegUnifiedTimes absent — bulk path
      },
      { kind: 'pair', outbound: origOut, ret: origRet }
    );

    const expectedRetMs = NEW_OUT_MS + ORIG_DELTA_MS;
    const expectedRetIso = new Date(expectedRetMs).toISOString();

    expect(result.return!.scheduled_at).toBe(expectedRetIso);
    expect(result.return!.requested_date).toBe(
      instantToYmdInBusinessTz(expectedRetMs)
    );
  });

  test('15. [Day alignment] return open, outbound timed near midnight → return requested_date matches outbound business day', () => {
    // Outbound at 23:30 Berlin on 2026-06-20 = 21:30 UTC (still June 20 in Berlin)
    // but targetDateYmd is also 2026-06-20; verify alignment uses the outbound instant's
    // business-day rather than just targetDateYmd raw.
    const LATE_OUT_ISO = '2026-06-20T21:30:00.000Z'; // 23:30 Berlin — still June 20
    const LATE_OUT_MS = new Date(LATE_OUT_ISO).getTime();
    const LATE_OUT_REQ_YMD = instantToYmdInBusinessTz(LATE_OUT_MS); // '2026-06-20'

    const lateOut = tripStub({ id: 'late-out', scheduled_at: LATE_OUT_ISO });
    const lateRet = tripStub({ id: 'late-ret', scheduled_at: null }); // return is untimed in source

    const result = deriveDuplicateSchedules(
      {
        ids: ['late-out'],
        targetDateYmd: TARGET_DATE_YMD,
        scheduleMode: 'unified_time',
        explicitPerLegUnifiedTimes: true,
        unifiedScheduledAtIso: LATE_OUT_ISO
        // unifiedReturnScheduledAtIso absent → open return
      },
      { kind: 'pair', outbound: lateOut, ret: lateRet }
    );

    expect(result.return!.scheduled_at).toBeNull();
    // The return's requested_date must align with the outbound's business day
    expect(result.return!.requested_date).toBe(LATE_OUT_REQ_YMD);
  });
});
