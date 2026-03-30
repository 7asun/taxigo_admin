/**
 * Shared schedule math for trip duplication (safe for client + server).
 * Wall-clock times use the trips business timezone — same as filters / trip-business-date.
 */

import { setHours, setMinutes, startOfDay } from 'date-fns';
import { tz } from '@date-fns/tz';

import { parseYmdToLocalDate } from '@/features/trips/lib/departure-schedule';
import {
  getTripsBusinessTimeZone,
  instantToYmdInBusinessTz,
  isYmdString
} from '@/features/trips/lib/trip-business-date';
import type { Trip } from '@/features/trips/api/trips.service';

export type DuplicateScheduleMode =
  | 'preserve_original_time'
  | 'unified_time'
  | 'time_open';

export interface DuplicateTripsPayload {
  ids: string[];
  targetDateYmd: string;
  scheduleMode: DuplicateScheduleMode;
  /** Required when `scheduleMode === 'unified_time'`: outbound pickup instant (ISO). */
  unifiedScheduledAtIso?: string;
}

function wallClockHmInBusinessTz(iso: string): { h: number; m: number } {
  const ms = new Date(iso).getTime();
  const inTz = tz(getTripsBusinessTimeZone());
  const d = inTz(ms);
  return { h: d.getHours(), m: d.getMinutes() };
}

/** Applies the source leg’s business-TZ wall clock to the target calendar day. */
export function computePreserveScheduleForLeg(
  sourceLeg: Trip,
  targetDateYmd: string
): { scheduled_at: string | null; requested_date: string | null } {
  if (!sourceLeg.scheduled_at) {
    return { scheduled_at: null, requested_date: targetDateYmd };
  }
  const { h, m } = wallClockHmInBusinessTz(sourceLeg.scheduled_at);
  const inTz = tz(getTripsBusinessTimeZone());
  const dayStart = startOfDay(inTz(targetDateYmd), { in: inTz });
  const withClock = setMinutes(setHours(dayStart, h, { in: inTz }), m, {
    in: inTz
  });
  return {
    scheduled_at: withClock.toISOString(),
    requested_date: targetDateYmd
  };
}

export function computeTimeOpenSchedule(targetDateYmd: string): {
  scheduled_at: string | null;
  requested_date: string | null;
} {
  return { scheduled_at: null, requested_date: targetDateYmd };
}

export function computeReturnScheduleForDuplicate(
  origOut: Trip,
  origRet: Trip,
  newOut: { scheduled_at: string | null; requested_date: string | null },
  mode: DuplicateScheduleMode,
  targetDateYmd: string,
  unifiedScheduledAtIso: string | undefined
): { scheduled_at: string | null; requested_date: string | null } {
  if (mode === 'time_open') {
    return computeTimeOpenSchedule(targetDateYmd);
  }
  if (mode === 'preserve_original_time') {
    return computePreserveScheduleForLeg(origRet, targetDateYmd);
  }

  if (!newOut.scheduled_at) {
    return { scheduled_at: null, requested_date: targetDateYmd };
  }
  if (!origRet.scheduled_at || !origOut.scheduled_at) {
    // unified_time + TBD return (or legacy pair missing a timestamp): keep `scheduled_at` null
    // but align `requested_date` with the **new outbound’s** business calendar day. Using only
    // `targetDateYmd` here caused Hin (31.) vs Rück (30.) when the DateTimePicker instant fell on
    // a different local day than the DatePicker — that path exists only in duplication, not in
    // create-form / cron / bulk-upload.
    const alignedReq =
      newOut.requested_date ??
      instantToYmdInBusinessTz(new Date(newOut.scheduled_at).getTime());
    return { scheduled_at: null, requested_date: alignedReq };
  }
  const delta =
    new Date(origRet.scheduled_at).getTime() -
    new Date(origOut.scheduled_at).getTime();
  const retMs = new Date(newOut.scheduled_at).getTime() + delta;
  return {
    scheduled_at: new Date(retMs).toISOString(),
    requested_date: instantToYmdInBusinessTz(retMs)
  };
}

/**
 * Validates payload shape and calendar string; throws Error with German message for API layer.
 */
export function parseDuplicateTripsPayload(
  body: unknown
): DuplicateTripsPayload {
  if (!body || typeof body !== 'object') {
    throw new Error('Ungültige Anfrage.');
  }
  const o = body as Record<string, unknown>;
  const rawIds = o.ids;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new Error('Keine Fahrten ausgewählt.');
  }
  const ids = [
    ...new Set(
      rawIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
    )
  ];
  if (ids.length === 0) {
    throw new Error('Keine gültigen Fahrten-IDs.');
  }

  const targetDateYmd =
    typeof o.targetDateYmd === 'string' ? o.targetDateYmd.trim() : '';
  if (!isYmdString(targetDateYmd) || !parseYmdToLocalDate(targetDateYmd)) {
    throw new Error('Ungültiges Datum.');
  }

  const mode = o.scheduleMode;
  if (
    mode !== 'preserve_original_time' &&
    mode !== 'unified_time' &&
    mode !== 'time_open'
  ) {
    throw new Error('Ungültiger Zeitmodus.');
  }

  let unifiedScheduledAtIso: string | undefined;
  if (mode === 'unified_time') {
    const u = o.unifiedScheduledAtIso;
    if (typeof u !== 'string' || !u) {
      throw new Error('Bitte Datum und Uhrzeit festlegen.');
    }
    const d = new Date(u);
    if (Number.isNaN(d.getTime())) {
      throw new Error('Ungültige Uhrzeit.');
    }
    unifiedScheduledAtIso = d.toISOString();
  }

  return {
    ids,
    targetDateYmd,
    scheduleMode: mode,
    unifiedScheduledAtIso
  };
}
