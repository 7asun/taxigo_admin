/**
 * Pure hour math for driver day plans — TIME strings only, no Date/toISOString.
 *
 * WHY no Date objects: planned_start/planned_end are Postgres TIME (wall clock),
 * not instants; Berlin trip-time invariants do not apply but we keep the same
 * minute-based approach as shift-time-form for consistency.
 */

import type { DriverDayPlan } from '../types';
import { PLAN_STATUSES_WITH_TIMES } from '../types';

/** Mirror shift-time-form parseTimeToMinutes — features stay decoupled. */
export function parseTimeToMinutes(time: string): number {
  const hm = time.slice(0, 5);
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function formatTimeRange(plan: DriverDayPlan): string | null {
  if (!plan.planned_start && !plan.planned_end) return null;
  const fmt = (t: string) => t.slice(0, 5);
  if (plan.planned_start && plan.planned_end) {
    return `${fmt(plan.planned_start)} – ${fmt(plan.planned_end)}`;
  }
  if (plan.planned_start) return `ab ${fmt(plan.planned_start)}`;
  return `bis ${fmt(plan.planned_end!)}`;
}

/**
 * Decimal hours for one plan row. WHY PLAN_STATUSES_WITH_TIMES guard: vacation/sick
 * rows must not contribute to weekly totals even if stale times exist in DB.
 * WHY overnight +24h: same rule as shift-time-form formatPaidDuration.
 */
export function calcDayHours(plan: DriverDayPlan): number {
  if (
    !PLAN_STATUSES_WITH_TIMES.includes(
      plan.status as (typeof PLAN_STATUSES_WITH_TIMES)[number]
    )
  ) {
    return 0;
  }
  if (!plan.planned_start || !plan.planned_end) return 0;

  const startMin = parseTimeToMinutes(plan.planned_start);
  let endMin = parseTimeToMinutes(plan.planned_end);
  if (endMin < startMin) endMin += 24 * 60;

  const totalMin = endMin - startMin;
  if (totalMin <= 0) return 0;
  return totalMin / 60;
}

export function calcWeekHours(plans: DriverDayPlan[]): number {
  const sum = plans.reduce((acc, p) => acc + calcDayHours(p), 0);
  return Math.round(sum * 10) / 10;
}

/** German decimal comma; em dash when zero hours. */
export function formatHours(decimalHours: number): string {
  if (decimalHours <= 0) return '–';
  const formatted = decimalHours.toLocaleString('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  });
  return `${formatted} h`;
}
