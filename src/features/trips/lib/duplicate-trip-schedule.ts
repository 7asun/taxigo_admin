/**
 * Shared schedule math for trip duplication (safe for client + server).
 * Wall-clock times use the trips business timezone — same as filters / trip-business-date.
 *
 * `explicitPerLegUnifiedTimes` (detail sheet + one pair): optional ISO per leg; see
 * `parseDuplicateTripsPayload` and `docs/trips-duplicate.md`.
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
  /**
   * Outbound (Hinfahrt) instant when `scheduleMode === 'unified_time'`.
   * Required **unless** `explicitPerLegUnifiedTimes` is true (then optional: omit = no time on copy).
   */
  unifiedScheduledAtIso?: string;
  /**
   * When set, return leg uses this instant; server skips `computeReturnScheduleForDuplicate`
   * for that leg. Optional with `explicitPerLegUnifiedTimes` (omit = no time on copy).
   */
  unifiedReturnScheduledAtIso?: string;
  /**
   * Detail + one Hin/Rück pair: two independent time fields in the dialog; each ISO optional.
   * Validated only with `unified_time`; `executeDuplicateTrips` requires exactly one pair in the batch.
   */
  explicitPerLegUnifiedTimes?: boolean;
  /**
   * When omitted or true: load each row’s paired leg (Hin/Rück) before insert — same as Fahrten bulk.
   * When false: only IDs in `ids` are loaded (detail sheet “nur diese Fahrt”). Bulk clients should omit this.
   * @see docs/trips-duplicate.md
   */
  includeLinkedLeg?: boolean;
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

/**
 * Wall-clock time on `targetDateYmd` in the trips business TZ (same basis as
 * `computePreserveScheduleForLeg`). Used by the duplicate dialog: date comes from
 * “Neues Datum”, time from `<input type="time">`.
 */
export function combineYmdAndHmToIsoString(
  targetDateYmd: string,
  hm: string
): string {
  const trimmed = hm.trim();
  const m = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    throw new Error('Ungültige Uhrzeit.');
  }
  const h = Math.min(23, Math.max(0, parseInt(m[1], 10)));
  const min = Math.min(59, Math.max(0, parseInt(m[2], 10)));
  const inTz = tz(getTripsBusinessTimeZone());
  const dayStart = startOfDay(inTz(targetDateYmd), { in: inTz });
  const withClock = setMinutes(setHours(dayStart, h, { in: inTz }), min, {
    in: inTz
  });
  return withClock.toISOString();
}

/**
 * API always receives `unifiedScheduledAtIso` as the **Hinfahrt** (outbound) instant.
 * When the user sets the **Rückfahrt** time instead, derive outbound by the same delta as in the source pair.
 */
export function outboundIsoFromUnifiedTimeChoice(options: {
  targetDateYmd: string;
  hm: string;
  anchor: 'hinfahrt' | 'rueckfahrt';
  pair: { outbound: Trip; ret: Trip } | null;
}): string {
  const { targetDateYmd, hm, anchor, pair } = options;
  if (!pair) {
    return combineYmdAndHmToIsoString(targetDateYmd, hm);
  }
  if (anchor === 'hinfahrt') {
    return combineYmdAndHmToIsoString(targetDateYmd, hm);
  }
  if (!pair.outbound.scheduled_at || !pair.ret.scheduled_at) {
    throw new Error(
      'Für die Angabe zur Rückfahrt brauchen Hinfahrt und Rückfahrt in der Vorlage eine Uhrzeit.'
    );
  }
  const retOnTargetMs = new Date(
    combineYmdAndHmToIsoString(targetDateYmd, hm)
  ).getTime();
  const delta =
    new Date(pair.ret.scheduled_at).getTime() -
    new Date(pair.outbound.scheduled_at).getTime();
  return new Date(retOnTargetMs - delta).toISOString();
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
 * Validates POST body for `/api/trips/duplicate`. German error messages for the API layer.
 * When `explicitPerLegUnifiedTimes` is true, `unifiedScheduledAtIso` / `unifiedReturnScheduledAtIso`
 * may both be omitted (empty legs stay without `scheduled_at` on the copy).
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

  let explicitPerLegUnifiedTimes = false;
  if (o.explicitPerLegUnifiedTimes !== undefined) {
    if (o.explicitPerLegUnifiedTimes !== true) {
      throw new Error('Ungültige Anfrage.');
    }
    if (mode !== 'unified_time') {
      throw new Error('Ungültige Anfrage.');
    }
    explicitPerLegUnifiedTimes = true;
  }

  let unifiedScheduledAtIso: string | undefined;
  let unifiedReturnScheduledAtIso: string | undefined;

  if (mode === 'unified_time') {
    if (explicitPerLegUnifiedTimes) {
      const u = o.unifiedScheduledAtIso;
      if (u !== undefined && u !== null && u !== '') {
        if (typeof u !== 'string') {
          throw new Error('Ungültige Uhrzeit.');
        }
        const d = new Date(u);
        if (Number.isNaN(d.getTime())) {
          throw new Error('Ungültige Uhrzeit.');
        }
        unifiedScheduledAtIso = d.toISOString();
      }
      const r = o.unifiedReturnScheduledAtIso;
      if (r !== undefined && r !== null && r !== '') {
        if (typeof r !== 'string') {
          throw new Error('Ungültige Rückfahrt-Zeit.');
        }
        const dr = new Date(r);
        if (Number.isNaN(dr.getTime())) {
          throw new Error('Ungültige Rückfahrt-Zeit.');
        }
        unifiedReturnScheduledAtIso = dr.toISOString();
      }
    } else {
      const u = o.unifiedScheduledAtIso;
      if (typeof u !== 'string' || !u) {
        throw new Error('Bitte eine Abholzeit festlegen.');
      }
      const d = new Date(u);
      if (Number.isNaN(d.getTime())) {
        throw new Error('Ungültige Uhrzeit.');
      }
      unifiedScheduledAtIso = d.toISOString();
      if ('unifiedReturnScheduledAtIso' in o) {
        const r = o.unifiedReturnScheduledAtIso;
        if (r !== undefined && r !== null) {
          if (typeof r !== 'string' || !r) {
            throw new Error('Ungültige Rückfahrt-Zeit.');
          }
          const dr = new Date(r);
          if (Number.isNaN(dr.getTime())) {
            throw new Error('Ungültige Rückfahrt-Zeit.');
          }
          unifiedReturnScheduledAtIso = dr.toISOString();
        }
      }
    }
  }

  // Default true: older clients and bulk UI never send this field; behaviour must stay unchanged.
  if (
    'includeLinkedLeg' in o &&
    o.includeLinkedLeg !== undefined &&
    typeof o.includeLinkedLeg !== 'boolean'
  ) {
    throw new Error('Ungültiger Wert für includeLinkedLeg.');
  }
  const includeLinkedLeg =
    typeof o.includeLinkedLeg === 'boolean' ? o.includeLinkedLeg : true;

  return {
    ids,
    targetDateYmd,
    scheduleMode: mode,
    unifiedScheduledAtIso,
    unifiedReturnScheduledAtIso,
    includeLinkedLeg,
    ...(explicitPerLegUnifiedTimes ? { explicitPerLegUnifiedTimes: true } : {})
  };
}
