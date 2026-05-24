/**
 * Driver planning types — admin schedule entries per driver per day.
 *
 * PLAN_STATUSES is the single source of truth for status keys and German labels.
 * Phase 1 uses a TS const + Postgres CHECK (not a reference table) to keep reporting
 * SQL simple; add new values in types.ts and a migration ALTER CHECK when HR expands.
 */

import type { Database } from '@/types/database.types';

export const PLAN_STATUSES = {
  working: 'Arbeitstag',
  day_off: 'Frei',
  vacation: 'Urlaub',
  sick: 'Krank',
  half_day_vacation: 'Halber Urlaub',
  overtime: 'Überstunden',
  training: 'Fortbildung',
  special_leave: 'Sonderurlaub'
} as const;

export type PlanStatus = keyof typeof PLAN_STATUSES;

/** Statuses that show planned start/end time fields in the edit sheet. */
export const PLAN_STATUSES_WITH_TIMES: PlanStatus[] = [
  'working',
  'overtime',
  'half_day_vacation',
  'training'
];

export type DriverDayPlanRow =
  Database['public']['Tables']['driver_day_plans']['Row'];

export type DriverDayPlanVehicle = {
  id: string;
  name: string;
  license_plate: string;
};

export type DriverDayPlan = DriverDayPlanRow & {
  vehicle?: DriverDayPlanVehicle | null;
};

export type PlanningDriverListItem = { id: string; full_name: string };

export type UpsertDayPlanPayload = {
  driverId: string;
  planDate: string;
  status: PlanStatus;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  vehicleId?: string | null;
  notes?: string | null;
};
