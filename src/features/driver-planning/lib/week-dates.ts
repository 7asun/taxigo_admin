import {
  getTripsBusinessTimeZone,
  instantToYmdInBusinessTz,
  ymdToPickerDate
} from '@/features/trips/lib/trip-business-date';
import { addDays, startOfWeek } from 'date-fns';
import { tz } from '@date-fns/tz';

/** Snap any YMD to the Monday of that ISO week in Europe/Berlin. */
export function snapYmdToWeekStart(ymd: string): string {
  const inTz = tz(getTripsBusinessTimeZone());
  const anchor = ymdToPickerDate(ymd);
  const monday = startOfWeek(anchor, { weekStartsOn: 1, in: inTz });
  return instantToYmdInBusinessTz(monday.getTime());
}

/** Sunday YMD for a Monday weekStartYmd (inclusive week range). */
export function getWeekEndYmd(weekStartYmd: string): string {
  const inTz = tz(getTripsBusinessTimeZone());
  const monday = ymdToPickerDate(weekStartYmd);
  const sunday = addDays(monday, 6, { in: inTz });
  return instantToYmdInBusinessTz(sunday.getTime());
}

/** Seven consecutive plan_date strings Mon–So. */
export function buildWeekPlanDates(weekStartYmd: string): string[] {
  const inTz = tz(getTripsBusinessTimeZone());
  const monday = ymdToPickerDate(weekStartYmd);
  return Array.from({ length: 7 }, (_, i) =>
    instantToYmdInBusinessTz(addDays(monday, i, { in: inTz }).getTime())
  );
}
