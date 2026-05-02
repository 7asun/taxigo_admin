/**
 * Create-trip departure: calendar day (yyyy-MM-dd, local) + optional HH:mm,
 * aligned with bulk CSV `parseDateAndTime` → `scheduled_at` / `requested_date`.
 */

import { buildScheduledAt } from '@/features/trips/lib/trip-time';

export function parseYmdToLocalDate(ymd: string): Date | undefined {
  const t = ymd.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return undefined;
  const [y, m, d] = t.split('-').map(Number);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return undefined;
  return new Date(y, m - 1, d);
}

export function formatLocalYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function combineDepartureForTripInsert(
  departureDateYmd: string,
  departureTimeHhmm: string
): { scheduled_at: string | null; requested_date: string | null } {
  const ymd = departureDateYmd.trim();
  if (!ymd) {
    return { scheduled_at: null, requested_date: null };
  }

  const base = parseYmdToLocalDate(ymd);
  if (!base) {
    return { scheduled_at: null, requested_date: null };
  }

  const requested_date = ymd;
  const timePart = departureTimeHhmm.trim();
  if (!timePart) {
    return { scheduled_at: null, requested_date };
  }

  // WHY `buildScheduledAt` (not `new Date(y,m,d,h,m)` + `toISOString()`): the old path
  // encoded the dispatcher’s wall clock in the **browser runtime** timezone. Anyone
  // outside Europe/Berlin (or SSR in UTC) persisted the wrong UTC instant vs Fahrten /
  // cron, which always interpret date+time in `getTripsBusinessTimeZone()`.
  // WHY throws on bad input: `buildScheduledAt` raises `TripTimeError` so corrupt
  // strings cannot silently become NULL timestamps that break dedup and day filters.
  return { scheduled_at: buildScheduledAt(ymd, timePart), requested_date };
}
