import { parseYmdToLocalDate } from '@/lib/date-ymd';
import type { ShiftDaySummary } from '../types';

/**
 * Groups RPC-ordered day rows by calendar month (de-DE month title). Preserves
 * input order within each month (newest-first from the RPC).
 */
export function groupByMonth(
  summaries: ShiftDaySummary[]
): { monthLabel: string; days: ShiftDaySummary[] }[] {
  const groups: { monthLabel: string; days: ShiftDaySummary[] }[] = [];
  for (const day of summaries) {
    const d = parseYmdToLocalDate(day.date);
    if (!d) continue;
    const monthLabel = new Intl.DateTimeFormat('de-DE', {
      month: 'long',
      year: 'numeric'
    }).format(d);
    const last = groups[groups.length - 1];
    if (last && last.monthLabel === monthLabel) {
      last.days.push(day);
    } else {
      groups.push({ monthLabel, days: [day] });
    }
  }
  return groups;
}
