import {
  buildScheduledAt,
  parseScheduledAt,
  TripTimeError
} from '@/features/trips/lib/trip-time';

/** Keeps calendar day from `scheduledIso`, replaces clock time with `HH:mm`. */
export function applyTimeToScheduledDate(
  scheduledIso: string,
  timeHHmm: string
): Date {
  // WHY single `TripTimeError` catch: `trip-detail-sheet` calls this from `detailsDirty`
  // during render — failures from `parseScheduledAt` or `buildScheduledAt` must not
  // crash the sheet; we fall back to the stored instant for dirty detection while typing.
  try {
    const { ymd } = parseScheduledAt(scheduledIso);
    return new Date(buildScheduledAt(ymd, timeHHmm));
  } catch (e) {
    if (e instanceof TripTimeError) {
      return new Date(scheduledIso);
    }
    throw e;
  }
}

/**
 * Local calendar `yyyy-MM-dd` + `HH:mm` → `Date` at that wall time in the trips business TZ.
 *
 * WHY `buildScheduledAt` (not `new Date(y,m,d,h,m)`): browser-local `Date` + runtime TZ
 * mis-encodes dispatcher intent for non-Berlin clients vs Fahrten/cron.
 */
export function buildScheduledAtFromYmdAndHm(
  dateYmd: string,
  timeHHmm: string
): Date {
  return new Date(buildScheduledAt(dateYmd, timeHHmm));
}
