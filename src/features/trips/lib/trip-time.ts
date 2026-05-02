/**
 * Canonical helpers for constructing and parsing trips.scheduled_at (UTC ISO)
 * from business-local calendar dates and wall-clock times.
 *
 * Read-side day windows stay in `./trip-business-date`.
 */

import { format, setHours, setMinutes, startOfDay } from 'date-fns';
import { tz } from '@date-fns/tz';

import {
  getTripsBusinessTimeZone,
  isYmdString
} from '@/features/trips/lib/trip-business-date';

/**
 * Thrown when `buildScheduledAt` cannot interpret `ymd` / `hm` as a Berlin-intent instant.
 *
 * WHY throw (not silent null): bad inputs must not silently become `scheduled_at`
 * timestamps — cron dedup keys and uniqueness checks rely on accurate instants,
 * so validation failures surface as exceptions for callers to translate to UX.
 */
export class TripTimeError extends Error {
  constructor(message = 'Invalid trip time input') {
    super(message);
    this.name = 'TripTimeError';
  }
}

const HM_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Normalizes user/cron-like time inputs to HH:mm only.
 *
 * WHY strip seconds (HH:mm:ss → HH:mm): cron and CSV sources pad HH:mm:ss; we keep
 * a single persisted shape (minute resolution) consistent with `<input type="time">`-style callers.
 *
 * WHY strict pattern: rejecting odd strings prevents subtly wrong database values.
 *
 * @throws {TripTimeError} when trimmed `hm` is not HH:mm or HH:mm:ss in range
 */
function normalizeHm(hm: string): string {
  const trimmed = hm.trim();
  const m = trimmed.match(HM_RE);
  if (!m) {
    throw new TripTimeError('Invalid time format: expected HH:mm or HH:mm:ss');
  }
  const hRaw = Number(m[1]);
  const miRaw = Number(m[2]);
  const sec = m[3] !== undefined ? Number(m[3]) : undefined;
  if (
    Number.isNaN(hRaw) ||
    Number.isNaN(miRaw) ||
    (sec !== undefined && (Number.isNaN(sec) || sec < 0 || sec > 59))
  ) {
    throw new TripTimeError('Invalid time values');
  }
  if (
    !Number.isInteger(hRaw) ||
    !Number.isInteger(miRaw) ||
    (sec !== undefined && !Number.isInteger(sec)) ||
    hRaw < 0 ||
    hRaw > 23 ||
    miRaw < 0 ||
    miRaw > 59
  ) {
    throw new TripTimeError('Invalid clock range');
  }
  return `${pad2(hRaw)}:${pad2(miRaw)}`;
}

/**
 * Constructs UTC ISO (`trips.scheduled_at`) from a business-local calendar day + wall-clock.
 *
 * WHY `getTripsBusinessTimeZone()` (not `Intl` / runtime default): admins and cron run in
 * UTC (Vercel) or varied browsers; tying storage to NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE
 * aligns writes with how Fahrten reads via `getZonedDayBoundsIso` in `trip-business-date.ts`.
 *
 * On DST fall-back days, a given local `HH:mm` can be ambiguous or fall in a gap — resolution
 * follows `@date-fns/tz` + `setHours`/`setMinutes` (same baseline as duplicate-trip schedule math).
 */
export function buildScheduledAt(
  ymd: string,
  hm: string,
  timeZone?: string
): string {
  const ymdTrimmed = ymd.trim();
  if (!ymdTrimmed) {
    throw new TripTimeError('Calendar date cannot be empty');
  }
  if (!isYmdString(ymdTrimmed)) {
    throw new TripTimeError('Invalid calendar date: expected YYYY-MM-DD');
  }

  const hmNorm = normalizeHm(hm);
  const hour = Number(hmNorm.slice(0, 2));
  const minute = Number(hmNorm.slice(3, 5));
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new TripTimeError('Invalid time');
  }

  const zone = timeZone ?? getTripsBusinessTimeZone();
  const inTz = tz(zone);

  const anchor = inTz(ymdTrimmed);
  const dayStart = startOfDay(anchor, { in: inTz });
  const calendarCheck = format(dayStart, 'yyyy-MM-dd', { in: inTz });
  // WHY canonicalize ymd vs calendar: rejects unrealistic dates (e.g. 2026-02-31) that
  // would otherwise silently roll forward in TZ math — same invariant as rejecting bad hm.
  if (calendarCheck !== ymdTrimmed) {
    throw new TripTimeError('Invalid calendar date for timezone');
  }

  const wall = setMinutes(setHours(dayStart, hour, { in: inTz }), minute, {
    in: inTz
  });

  const ms = wall.getTime();
  if (Number.isNaN(ms)) {
    throw new TripTimeError('Unable to derive instant');
  }

  const utc = new Date(ms);
  utc.setUTCMilliseconds(0);
  return utc.toISOString();
}

/**
 * Nullable wrapper for optional departure clocks — aligns with `scheduled_at = null`,
 * separate `requested_date` flows without inventing sentinel timestamps.
 *
 * WHY delegate to `buildScheduledAt`: one implementation path avoids silent drift between
 * “optional vs required” callers.
 *
 * WHY null on empty/null: CSV / forms omit blanks; coercion is explicit at the boundary.
 */
export function buildScheduledAtOrNull(
  ymd: string | null | undefined,
  hm: string | null | undefined,
  timeZone?: string
): string | null {
  if (ymd === null || ymd === undefined || ymd.trim() === '') {
    return null;
  }
  if (hm === null || hm === undefined || hm.trim() === '') {
    return null;
  }
  return buildScheduledAt(ymd, hm, timeZone);
}

/**
 * Interprets a stored UTC instant as `{ ymd, hm }` in the same business TZ Fahrten uses.
 *
 * WHY same TZ module as reads: dashboards and reschedule UIs must show the dispatcher’s
 * local calendar/time that matches filtered lists from `trip-business-date` bounds.
 *
 * Inverse of {@link buildScheduledAt} — round-trips discard sub-minute precision (`hm` HH:mm).
 */
export function parseScheduledAt(
  iso: string,
  timeZone?: string
): { ymd: string; hm: string } {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) {
    throw new TripTimeError('Invalid ISO timestamp');
  }

  const zone = timeZone ?? getTripsBusinessTimeZone();
  const inTz = tz(zone);

  const d = inTz(ms);
  return {
    ymd: format(d, 'yyyy-MM-dd', { in: inTz }),
    hm: format(d, 'HH:mm', { in: inTz })
  };
}

/**
 * WHY: display paths need a Berlin civil ymd from a stored
 * scheduled_at ISO without throwing on invalid or null input.
 * Uses the same TZ as parseScheduledAt (getTripsBusinessTimeZone()).
 * Returns null when iso is null, undefined, or not a valid
 * ISO instant — callers must handle null for display fallback.
 */
export function parseScheduledAtOrFallback(
  iso: string | null | undefined
): { ymd: string; hm: string } | null {
  if (!iso) return null;
  try {
    return parseScheduledAt(iso);
  } catch {
    return null;
  }
}
