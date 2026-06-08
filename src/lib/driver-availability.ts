/**
 * Shared driver availability types and client-safe helpers.
 * Server fetchers live in driver-availability.server.ts.
 */

import type { PlanStatus } from '@/features/driver-planning/types';
import {
  instantToYmdInBusinessTz,
  isYmdString,
  todayYmdInBusinessTz
} from '@/features/trips/lib/trip-business-date';

/** Derived availability for a single driver on a single Berlin calendar date. */
export type DriverAvailability =
  | 'available'
  | 'vacation'
  | 'sick'
  | 'day_off'
  | 'half_day_vacation'
  | 'special_leave'
  | 'training'
  | 'overtime'
  | 'unknown';

/**
 * Statuses that mean "do not dispatch this driver today".
 * WHY half_day_vacation is excluded: product treats half-day as dispatchable with caution;
 * change this list only with explicit HR/dispatch sign-off.
 */
export const UNAVAILABLE_STATUSES: DriverAvailability[] = [
  'vacation',
  'sick',
  'day_off',
  'special_leave',
  'training'
];

export type DriverDayContext = {
  driverId: string;
  date: string;
  plan: {
    status: DriverAvailability;
    plannedStart: string | null;
    plannedEnd: string | null;
    notes: string | null;
  } | null;
  shift: {
    id: string;
    startedAt: string;
    endedAt: string | null;
    breakMinutes: number;
  } | null;
  availability: DriverAvailability;
  isDispatchable: boolean;
};

/** Roster Ist-Zeit overlay — Berlin wall-clock times pre-formatted for display. */
export type ShiftSummary = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  breakMinutes: number;
  startHm: string;
  endHm: string;
};

export type CompanyWeekShiftsMap = Map<string, Map<string, ShiftSummary>>;

export function planStatusToAvailability(
  status: PlanStatus
): DriverAvailability {
  if (status === 'working') return 'available';
  return status;
}

export function deriveIsDispatchable(
  availability: DriverAvailability
): boolean {
  return !UNAVAILABLE_STATUSES.includes(availability);
}

/**
 * Resolve Fahrten `scheduled_at` URL param to a single Berlin YMD for availability lookups.
 * WHY range uses start YMD only: Kanban badges are day-scoped; multi-day filters show start-day plan.
 */
export function resolveTripsFilterDateYmd(
  scheduledAt: string | null | undefined
): string {
  if (!scheduledAt || scheduledAt.trim() === '') {
    return todayYmdInBusinessTz();
  }

  const parts = scheduledAt.split(',');
  if (parts.length === 2) {
    const fromMs = Number(parts[0]);
    if (!Number.isNaN(fromMs)) {
      return instantToYmdInBusinessTz(fromMs);
    }
  }

  const raw = parts[0]?.trim() ?? scheduledAt.trim();
  if (isYmdString(raw)) return raw;

  const timestamp = Number(raw);
  if (!Number.isNaN(timestamp)) {
    return instantToYmdInBusinessTz(timestamp);
  }

  return todayYmdInBusinessTz();
}

/** Serialize week shifts map for RSC → client hydration. */
export function serializeCompanyWeekShiftsMap(
  map: CompanyWeekShiftsMap
): Record<string, Record<string, ShiftSummary>> {
  const out: Record<string, Record<string, ShiftSummary>> = {};
  for (const [driverId, byDate] of map) {
    out[driverId] = Object.fromEntries(byDate);
  }
  return out;
}

export function deserializeCompanyWeekShiftsMap(
  raw: Record<string, Record<string, ShiftSummary>> | undefined
): CompanyWeekShiftsMap {
  const map: CompanyWeekShiftsMap = new Map();
  if (!raw) return map;
  for (const [driverId, byDate] of Object.entries(raw)) {
    map.set(driverId, new Map(Object.entries(byDate)));
  }
  return map;
}
