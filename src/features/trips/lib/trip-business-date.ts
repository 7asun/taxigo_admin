import { addDays, startOfDay } from 'date-fns';
import { tz } from '@date-fns/tz';

const DEFAULT_TZ = 'Europe/Berlin';

/**
 * IANA timezone for “which calendar day is this trip on?” in filters and bounds.
 * Must match on server and client — use NEXT_PUBLIC_* so the client can default the URL.
 */
export function getTripsBusinessTimeZone(): string {
  if (
    typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE
  ) {
    return process.env.NEXT_PUBLIC_TRIPS_BUSINESS_TIMEZONE;
  }
  return DEFAULT_TZ;
}

export function isYmdString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Calendar YYYY-MM-DD of an instant in the business timezone (not UTC). */
export function instantToYmdInBusinessTz(ms: number): string {
  const inTz = tz(getTripsBusinessTimeZone());
  const d = inTz(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayYmdInBusinessTz(): string {
  return instantToYmdInBusinessTz(Date.now());
}

/**
 * [start, end) in UTC ISO for the given local calendar day in the business TZ.
 */
export function getZonedDayBoundsIso(ymd: string): {
  startISO: string;
  endExclusiveISO: string;
} {
  const inTz = tz(getTripsBusinessTimeZone());
  const anchor = inTz(ymd);
  const dayStart = startOfDay(anchor, { in: inTz });
  const nextStart = addDays(dayStart, 1, { in: inTz });
  return {
    startISO: dayStart.toISOString(),
    endExclusiveISO: nextStart.toISOString()
  };
}

/** Date for react-day-picker `selected` — interpret YMD in business TZ. */
export function ymdToPickerDate(ymd: string): Date {
  return tz(getTripsBusinessTimeZone())(ymd) as Date;
}

/**
 * WHY: The widget must show Monday trips on Friday already (not Sunday),
 * because the dispatch team needs one full business day of preparation time.
 * A plain +1 calendar day is wrong on Fridays and weekends. This helper
 * centralises the "next business day" rule next to the other Berlin-TZ
 * date primitives so it stays testable and timezone-invariant.
 *
 * Rules:
 *   Monday–Thursday  → next calendar day  (+1)
 *   Friday           → next Monday        (+3)
 *   Saturday         → next Monday        (+2)
 *   Sunday           → next Monday        (+1)
 */
export function getNextBusinessDayYmd(ymd: string): string {
  const base = ymdToPickerDate(ymd); // local Date at midnight Berlin
  const dow = base.getDay(); // 0 = Sunday … 6 = Saturday
  const daysToAdd =
    dow === 5
      ? 3 // Friday → Monday
      : dow === 6
        ? 2 // Saturday → Monday
        : dow === 0
          ? 1 // Sunday → Monday (safety guard)
          : 1; // Mon–Thu → next calendar day
  const next = new Date(base);
  next.setDate(base.getDate() + daysToAdd);
  return instantToYmdInBusinessTz(next.getTime());
}
