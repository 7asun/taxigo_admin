/**
 * controlling-utils.ts — Berlin-TZ period math and German locale formatters.
 *
 * buildControllingPeriod uses todayYmdInBusinessTz() instead of new Date() because
 * browser/server local midnight does not match Europe/Berlin business calendar days
 * (see docs/plans/timezone-bug-audit-v2.md).
 */

import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
  subMonths
} from 'date-fns';
import { tz } from '@date-fns/tz';
import {
  getTripsBusinessTimeZone,
  instantToYmdInBusinessTz,
  isYmdString,
  todayYmdInBusinessTz
} from '@/features/trips/lib/trip-business-date';
import type {
  ControllingPeriod,
  ControllingPeriodKey,
  ControllingOperationalRow
} from '../types/controlling.types';

export const CONTROLLING_STALE_TIME_MS = 5 * 60 * 1000;
export const CONTROLLING_MONTHLY_CHART_MONTHS = 12;
export const HEATMAP_DAYS = 7;
export const HEATMAP_HOURS = 24;
export const REVENUE_BAR_CHART_HEIGHT_PX = 220;
export const REVENUE_SPARKLINE_HEIGHT_PX = 80;

const GERMAN_NUMBER = new Intl.NumberFormat('de-DE');
const GERMAN_EURO = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR'
});
const GERMAN_PERCENT = new Intl.NumberFormat('de-DE', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mär',
  'Apr',
  'Mai',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Okt',
  'Nov',
  'Dez'
] as const;

function businessTz() {
  return tz(getTripsBusinessTimeZone());
}

function ymdToDate(ymd: string): Date {
  return businessTz()(ymd) as Date;
}

function dateToYmd(date: Date): string {
  return instantToYmdInBusinessTz(date.getTime());
}

function assertYmd(value: string, label: string): void {
  if (!isYmdString(value)) {
    throw new Error(`${label} must be YYYY-MM-DD`);
  }
}

export function buildControllingPeriod(
  key: ControllingPeriodKey,
  customFrom?: string,
  customTo?: string
): ControllingPeriod {
  const today = todayYmdInBusinessTz();
  const todayDate = ymdToDate(today);
  const inTz = businessTz();

  switch (key) {
    case 'today':
      return {
        key,
        dateFrom: today,
        dateTo: today,
        label: 'Heute'
      };
    case 'this_week': {
      const weekStart = startOfWeek(todayDate, { weekStartsOn: 1, in: inTz });
      const weekEnd = endOfWeek(todayDate, { weekStartsOn: 1, in: inTz });
      return {
        key,
        dateFrom: dateToYmd(weekStart),
        dateTo: dateToYmd(weekEnd),
        label: 'Diese Woche'
      };
    }
    case 'this_month': {
      const monthStart = startOfMonth(todayDate, { in: inTz });
      const monthEnd = endOfMonth(todayDate, { in: inTz });
      return {
        key,
        dateFrom: dateToYmd(monthStart),
        dateTo: dateToYmd(monthEnd),
        label: 'Dieser Monat'
      };
    }
    case 'last_month': {
      const lastMonthDate = subMonths(todayDate, 1, { in: inTz });
      const monthStart = startOfMonth(lastMonthDate, { in: inTz });
      const monthEnd = endOfMonth(lastMonthDate, { in: inTz });
      return {
        key,
        dateFrom: dateToYmd(monthStart),
        dateTo: dateToYmd(monthEnd),
        label: 'Letzter Monat'
      };
    }
    case 'custom': {
      const from = customFrom ?? today;
      const to = customTo ?? today;
      assertYmd(from, 'customFrom');
      assertYmd(to, 'customTo');
      if (from > to) {
        throw new Error('Startdatum darf nicht nach Enddatum liegen');
      }
      return {
        key,
        dateFrom: from,
        dateTo: to,
        label: `${formatGermanDate(from)} – ${formatGermanDate(to)}`
      };
    }
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
}

/** Shift period back by the same inclusive day count for Δ% comparisons. */
export function buildPreviousControllingPeriod(
  period: ControllingPeriod
): ControllingPeriod {
  const fromDate = ymdToDate(period.dateFrom);
  const toDate = ymdToDate(period.dateTo);
  const dayCount =
    differenceInCalendarDays(toDate, fromDate, { in: businessTz() }) + 1;
  const prevTo = addDays(fromDate, -1, { in: businessTz() });
  const prevFrom = addDays(prevTo, -(dayCount - 1), { in: businessTz() });

  return {
    key: period.key,
    dateFrom: dateToYmd(prevFrom),
    dateTo: dateToYmd(prevTo),
    label: `Vorperiode (${formatGermanDate(dateToYmd(prevFrom))} – ${formatGermanDate(dateToYmd(prevTo))})`
  };
}

export function getPeriodLabel(period: ControllingPeriod): string {
  return period.label;
}

export function formatEuro(value: number): string {
  return GERMAN_EURO.format(value);
}

export function formatKm(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString('de-DE', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} km`;
}

export function formatPercent(value: number): string {
  return GERMAN_PERCENT.format(value / 100);
}

export function formatPercentDelta(
  current: number,
  previous: number
): {
  label: string;
  isUp: boolean;
} {
  if (previous === 0) {
    if (current === 0) {
      return { label: '0,0 %', isUp: true };
    }
    return { label: '+100,0 %', isUp: true };
  }
  const delta = ((current - previous) / previous) * 100;
  const isUp = delta >= 0;
  const formatted = (Math.round(Math.abs(delta) * 10) / 10).toLocaleString(
    'de-DE',
    { minimumFractionDigits: 1, maximumFractionDigits: 1 }
  );
  const sign = isUp ? '+' : '−';
  return {
    label: `${sign}${formatted} %`,
    isUp
  };
}

export function formatGermanDate(ymd: string): string {
  const [year, month, day] = ymd.split('-');
  return `${day}.${month}.${year}`;
}

export function formatInteger(value: number): string {
  return GERMAN_NUMBER.format(value);
}

export function formatTripsPerDay(
  tripCount: number,
  activeDays: number
): string {
  if (activeDays <= 0) return '—';
  const rate = tripCount / activeDays;
  return `${GERMAN_NUMBER.format(rate)} Fahrten/Tag`;
}

export function getWeekdayLabel(dayOfWeek: number): string {
  return WEEKDAY_LABELS[dayOfWeek] ?? '?';
}

export function getMonthLabel(monthIndex: number): string {
  return MONTH_LABELS[monthIndex] ?? '?';
}

export function aggregateOperationalRows(rows: ControllingOperationalRow[]) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.total_trips += row.total_trips;
      acc.cancelled_trips += row.cancelled_trips;
      acc.revenue_net += Number(row.revenue_net);
      acc.total_km += Number(row.total_km);
      acc.unpriced_trips += row.unpriced_trips;
      acc.unassigned_trips += row.unassigned_trips;
      acc.wheelchair_trips += row.wheelchair_trips;
      acc.kts_trips += row.kts_trips;
      acc.fremdfirma_trips += row.fremdfirma_trips;
      acc.fremdfirma_cost += Number(row.fremdfirma_cost);
      if (row.avg_price_per_trip != null && row.total_trips > 0) {
        acc.pricedTripWeight += row.total_trips;
        acc.weightedPriceSum +=
          Number(row.avg_price_per_trip) * row.total_trips;
      }
      return acc;
    },
    {
      total_trips: 0,
      cancelled_trips: 0,
      revenue_net: 0,
      total_km: 0,
      unpriced_trips: 0,
      unassigned_trips: 0,
      wheelchair_trips: 0,
      kts_trips: 0,
      fremdfirma_trips: 0,
      fremdfirma_cost: 0,
      pricedTripWeight: 0,
      weightedPriceSum: 0
    }
  );

  const avg_price_per_trip =
    totals.pricedTripWeight > 0
      ? totals.weightedPriceSum / totals.pricedTripWeight
      : 0;
  const avg_km_per_trip =
    totals.total_trips > 0 ? totals.total_km / totals.total_trips : 0;
  const euro_per_km =
    totals.total_km > 0 ? totals.revenue_net / totals.total_km : 0;

  return {
    ...totals,
    avg_price_per_trip,
    avg_km_per_trip,
    euro_per_km
  };
}

/** Heatmap intensity 0–1 for CSS opacity scaling. */
export function heatmapIntensity(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.min(1, value / max);
}
