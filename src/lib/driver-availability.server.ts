/**
 * Server-only driver availability reads — admin Supabase boundary.
 */

import { requireAdminContext } from '@/features/driver-planning/api/driver-planning.service';
import { getWeekEndYmd } from '@/features/driver-planning/lib/week-dates';
import type { PlanStatus } from '@/features/driver-planning/types';
import { SHIFT_EVENT_TYPES } from '@/features/driver-portal/types';
import {
  getZonedDayBoundsIso,
  instantToYmdInBusinessTz
} from '@/features/trips/lib/trip-business-date';
import { parseScheduledAtOrFallback } from '@/features/trips/lib/trip-time';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type {
  CompanyWeekShiftsMap,
  DriverAvailability,
  DriverDayContext,
  ShiftSummary
} from '@/lib/driver-availability';
import {
  deriveIsDispatchable,
  planStatusToAvailability
} from '@/lib/driver-availability';

const PLAN_STATUS_VALUES: PlanStatus[] = [
  'working',
  'day_off',
  'vacation',
  'sick',
  'half_day_vacation',
  'overtime',
  'training',
  'special_leave'
];

function isPlanStatus(value: string): value is PlanStatus {
  return (PLAN_STATUS_VALUES as string[]).includes(value);
}

type ShiftEventRow = {
  event_type: string;
  timestamp: string | null;
};

function sortEventsByTimestamp(events: ShiftEventRow[]): ShiftEventRow[] {
  return [...events].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });
}

function breakMinutesFromEvents(events: ShiftEventRow[]): number {
  const ordered = sortEventsByTimestamp(events);
  let total = 0;

  for (let i = 0; i < ordered.length; i++) {
    const current = ordered[i];
    if (current.event_type !== SHIFT_EVENT_TYPES.BREAK_START) continue;

    const next = ordered[i + 1];
    if (!next || next.event_type !== SHIFT_EVENT_TYPES.BREAK_END) continue;
    if (!current.timestamp || !next.timestamp) continue;

    const startMs = new Date(current.timestamp).getTime();
    const endMs = new Date(next.timestamp).getTime();
    if (endMs > startMs) {
      total += Math.round((endMs - startMs) / 60_000);
    }
    i += 1;
  }

  return total;
}

function formatHmFromIso(iso: string | null): string {
  if (!iso) return '';
  const parsed = parseScheduledAtOrFallback(iso);
  return parsed?.hm ?? '';
}

function mapShiftRowToSummary(row: {
  id: string;
  started_at: string;
  ended_at: string | null;
  shift_events: ShiftEventRow[] | null;
}): ShiftSummary {
  const events = row.shift_events ?? [];
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    breakMinutes: breakMinutesFromEvents(events),
    startHm: formatHmFromIso(row.started_at),
    endHm: formatHmFromIso(row.ended_at)
  };
}

type PlanRow = {
  driver_id: string;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  notes: string | null;
};

type ShiftRow = {
  id: string;
  driver_id: string;
  started_at: string;
  ended_at: string | null;
  shift_events: ShiftEventRow[] | null;
};

function buildContextFromRows(
  driverId: string,
  dateYmd: string,
  plan: PlanRow | null,
  shift: ShiftRow | null
): DriverDayContext {
  const planBlock = plan
    ? {
        status: isPlanStatus(plan.status)
          ? planStatusToAvailability(plan.status)
          : ('unknown' as DriverAvailability),
        plannedStart: plan.planned_start?.slice(0, 5) ?? null,
        plannedEnd: plan.planned_end?.slice(0, 5) ?? null,
        notes: plan.notes
      }
    : null;

  const availability = planBlock?.status ?? 'unknown';
  const isDispatchable = deriveIsDispatchable(availability);

  return {
    driverId,
    date: dateYmd,
    plan: planBlock,
    shift: shift
      ? {
          id: shift.id,
          startedAt: shift.started_at,
          endedAt: shift.ended_at,
          breakMinutes: breakMinutesFromEvents(shift.shift_events ?? [])
        }
      : null,
    availability,
    isDispatchable
  };
}

export async function getDriverDayContext(
  driverId: string,
  dateYmd: string
): Promise<DriverDayContext> {
  const [ctx] = await getDriversDayContext([driverId], dateYmd);
  return ctx;
}

export async function getDriversDayContext(
  driverIds: string[],
  dateYmd: string
): Promise<DriverDayContext[]> {
  if (driverIds.length === 0) return [];

  const { supabase, companyId } = await requireAdminContext();
  const uniqueIds = [...new Set(driverIds)];

  // WHY getZonedDayBoundsIso: shifts are keyed by Berlin calendar date, not UTC midnight.
  const { startISO, endExclusiveISO } = getZonedDayBoundsIso(dateYmd);

  const [plansResult, shiftsResult] = await Promise.all([
    supabase
      .from('driver_day_plans')
      .select('driver_id, status, planned_start, planned_end, notes')
      .eq('company_id', companyId)
      .eq('plan_date', dateYmd)
      .in('driver_id', uniqueIds),
    supabase
      .from('shifts')
      .select(
        `
        id,
        driver_id,
        started_at,
        ended_at,
        shift_events (
          event_type,
          timestamp
        )
      `
      )
      .eq('company_id', companyId)
      .in('driver_id', uniqueIds)
      .gte('started_at', startISO)
      .lt('started_at', endExclusiveISO)
  ]);

  if (plansResult.error) throw toQueryError(plansResult.error);
  if (shiftsResult.error) throw toQueryError(shiftsResult.error);

  const planByDriver = new Map<string, PlanRow>();
  for (const row of (plansResult.data ?? []) as PlanRow[]) {
    planByDriver.set(row.driver_id, row);
  }

  const shiftByDriver = new Map<string, ShiftRow>();
  for (const row of (shiftsResult.data ?? []) as ShiftRow[]) {
    shiftByDriver.set(row.driver_id, row);
  }

  return uniqueIds.map((driverId) =>
    buildContextFromRows(
      driverId,
      dateYmd,
      planByDriver.get(driverId) ?? null,
      shiftByDriver.get(driverId) ?? null
    )
  );
}

export async function getActiveDriverIds(): Promise<string[]> {
  const { supabase, companyId } = await requireAdminContext();
  const { data, error } = await supabase
    .from('accounts')
    .select('id')
    .eq('company_id', companyId)
    .eq('role', 'driver')
    .eq('is_active', true);

  if (error) throw toQueryError(error);
  return (data ?? []).map((row) => row.id);
}

export async function getActiveDriversDayContext(
  dateYmd: string
): Promise<DriverDayContext[]> {
  const driverIds = await getActiveDriverIds();
  return getDriversDayContext(driverIds, dateYmd);
}

/**
 * Batch-fetch shifts for all company drivers in an ISO week (Mon–Sun).
 * Map key: driverId → Berlin plan_date YMD → ShiftSummary.
 *
 * WHY instantToYmdInBusinessTz on started_at: matches shifts_driver_berlin_date_unique
 * and getActualShiftDatesForWeek — never UTC midnight as a day proxy.
 */
export async function getCompanyWeekShiftsMap(
  weekStartYmd: string
): Promise<CompanyWeekShiftsMap> {
  const { supabase, companyId } = await requireAdminContext();
  const weekEndYmd = getWeekEndYmd(weekStartYmd);
  const { startISO } = getZonedDayBoundsIso(weekStartYmd);
  const { endExclusiveISO } = getZonedDayBoundsIso(weekEndYmd);

  const { data, error } = await supabase
    .from('shifts')
    .select(
      `
      id,
      driver_id,
      started_at,
      ended_at,
      shift_events (
        event_type,
        timestamp
      )
    `
    )
    .eq('company_id', companyId)
    .gte('started_at', startISO)
    .lt('started_at', endExclusiveISO);

  if (error) throw toQueryError(error);

  const map: CompanyWeekShiftsMap = new Map();

  for (const row of (data ?? []) as ShiftRow[]) {
    if (!row.started_at || !row.driver_id) continue;

    const dateKey = instantToYmdInBusinessTz(
      new Date(row.started_at).getTime()
    );
    const summary = mapShiftRowToSummary(row);

    let byDate = map.get(row.driver_id);
    if (!byDate) {
      byDate = new Map();
      map.set(row.driver_id, byDate);
    }
    byDate.set(dateKey, summary);
  }

  return map;
}
