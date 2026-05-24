/**
 * Driver planning — server-only Supabase access.
 *
 * Writes only to driver_day_plans — never shifts, shift_events, or shift_reconciliations.
 * requireAdminContext() is the first call in every export (same boundary as shift-reconciliations).
 */

import {
  getZonedDayBoundsIso,
  instantToYmdInBusinessTz
} from '@/features/trips/lib/trip-business-date';
import { createClient } from '@/lib/supabase/server';
import { toQueryError } from '@/lib/supabase/to-query-error';
import type {
  DriverDayPlan,
  DriverDayPlanVehicle,
  PlanningDriverListItem,
  PlanStatus,
  UpsertDayPlanPayload
} from '../types';
import { PLAN_STATUSES_WITH_TIMES } from '../types';
import { getWeekEndYmd } from '../lib/week-dates';

type AdminContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  companyId: string;
  userId: string;
};

async function requireAdminContext(): Promise<AdminContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new Error('Unauthorized');
  }
  const { data: account, error: accError } = await supabase
    .from('accounts')
    .select('role, company_id')
    .eq('id', user.id)
    .maybeSingle();
  if (accError) throw toQueryError(accError);
  if (
    account?.role !== 'admin' ||
    account.company_id == null ||
    account.company_id === ''
  ) {
    throw new Error('Forbidden');
  }
  return { supabase, companyId: account.company_id, userId: user.id };
}

function displayDriverName(row: {
  name: string | null;
  first_name: string | null;
  last_name: string | null;
}): string {
  if (row.name && row.name.trim().length > 0) return row.name.trim();
  const parts = [row.first_name, row.last_name].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0
  );
  return parts.join(' ').trim() || '—';
}

/** Monday YMD + 6 days in Europe/Berlin — plan_date filters use DATE strings, not UTC midnight. */
export { getWeekEndYmd } from '../lib/week-dates';

type VehicleEmbed = DriverDayPlanVehicle | DriverDayPlanVehicle[] | null;

function mapPlanRow(
  row: Record<string, unknown> & { vehicle?: VehicleEmbed }
): DriverDayPlan {
  const rawVehicle = row.vehicle;
  const vehicle = Array.isArray(rawVehicle)
    ? (rawVehicle[0] ?? null)
    : (rawVehicle ?? null);

  const { vehicle: _v, ...rest } = row;
  return {
    ...(rest as DriverDayPlan),
    vehicle
  };
}

/**
 * Active drivers in the admin's company (selector on planning page).
 */
export async function getPlanningDrivers(): Promise<PlanningDriverListItem[]> {
  const { supabase, companyId } = await requireAdminContext();
  const { data, error } = await supabase
    .from('accounts')
    .select('id, name, first_name, last_name')
    .eq('company_id', companyId)
    .eq('role', 'driver')
    .eq('is_active', true)
    .order('name');

  if (error) throw toQueryError(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    full_name: displayDriverName(row)
  }));
}

/**
 * All plan rows for one driver Mon–Sun (inclusive) by plan_date YMD bounds.
 * WHY DATE string bounds: plan_date is a Berlin calendar date column, not timestamptz.
 */
export async function getDriverWeekPlan(
  driverId: string,
  weekStartYmd: string
): Promise<DriverDayPlan[]> {
  const { supabase, companyId } = await requireAdminContext();
  const weekEndYmd = getWeekEndYmd(weekStartYmd);

  const { data, error } = await supabase
    .from('driver_day_plans')
    .select(
      `
      *,
      vehicle:vehicles(id, name, license_plate)
    `
    )
    .eq('company_id', companyId)
    .eq('driver_id', driverId)
    .gte('plan_date', weekStartYmd)
    .lte('plan_date', weekEndYmd)
    .order('plan_date', { ascending: true });

  if (error) throw toQueryError(error);
  return (data ?? []).map((row) =>
    mapPlanRow(row as Record<string, unknown> & { vehicle?: VehicleEmbed })
  );
}

/**
 * All plan rows for every driver in the company Mon–Sun (roster view).
 * WHY one query: single round trip vs N parallel getDriverWeekPlan calls.
 * WHY client-side grouping: RLS already scopes by company_id — same rows an admin
 * would see per driver; grouping by driver_id happens in the UI layer.
 */
export async function getCompanyWeekPlan(
  weekStartYmd: string
): Promise<DriverDayPlan[]> {
  const { supabase, companyId } = await requireAdminContext();
  const weekEndYmd = getWeekEndYmd(weekStartYmd);

  const { data, error } = await supabase
    .from('driver_day_plans')
    .select(
      `
      *,
      vehicle:vehicles(id, name, license_plate)
    `
    )
    .eq('company_id', companyId)
    .gte('plan_date', weekStartYmd)
    .lte('plan_date', weekEndYmd)
    .order('driver_id', { ascending: true })
    .order('plan_date', { ascending: true });

  if (error) throw toQueryError(error);
  return (data ?? []).map((row) =>
    mapPlanRow(row as Record<string, unknown> & { vehicle?: VehicleEmbed })
  );
}

/**
 * Read-only overlay: dates in the week where the driver has an ended shift row.
 * WHY read shifts: compare plan vs actual without writing to driver-owned shift tables.
 */
export async function getActualShiftDatesForWeek(
  driverId: string,
  weekStartYmd: string
): Promise<string[]> {
  const { supabase, companyId } = await requireAdminContext();
  const weekEndYmd = getWeekEndYmd(weekStartYmd);
  const { startISO } = getZonedDayBoundsIso(weekStartYmd);
  const { endExclusiveISO } = getZonedDayBoundsIso(weekEndYmd);

  const { data, error } = await supabase
    .from('shifts')
    .select('started_at')
    .eq('company_id', companyId)
    .eq('driver_id', driverId)
    .eq('status', 'ended')
    .gte('started_at', startISO)
    .lt('started_at', endExclusiveISO);

  if (error) throw toQueryError(error);

  const dates = new Set<string>();
  for (const row of data ?? []) {
    if (row.started_at) {
      dates.add(instantToYmdInBusinessTz(new Date(row.started_at).getTime()));
    }
  }
  return [...dates].sort();
}

function normalizeTimesForStatus(
  status: PlanStatus,
  plannedStart?: string | null,
  plannedEnd?: string | null
): { planned_start: string | null; planned_end: string | null } {
  if (!PLAN_STATUSES_WITH_TIMES.includes(status)) {
    return { planned_start: null, planned_end: null };
  }
  return {
    planned_start: plannedStart?.trim() ? plannedStart.trim() : null,
    planned_end: plannedEnd?.trim() ? plannedEnd.trim() : null
  };
}

/**
 * Upsert one day plan. WHY upsert: UNIQUE (company, driver, plan_date) matches product rule.
 * WHY updated_at in payload: no DB trigger — same pattern as company_profiles upsert.
 */
export async function upsertDayPlan(
  payload: UpsertDayPlanPayload
): Promise<DriverDayPlan> {
  const { supabase, companyId, userId } = await requireAdminContext();
  const now = new Date().toISOString();
  const times = normalizeTimesForStatus(
    payload.status,
    payload.plannedStart,
    payload.plannedEnd
  );

  const { data, error } = await supabase
    .from('driver_day_plans')
    .upsert(
      {
        company_id: companyId,
        driver_id: payload.driverId,
        plan_date: payload.planDate,
        status: payload.status,
        planned_start: times.planned_start,
        planned_end: times.planned_end,
        vehicle_id: payload.vehicleId ?? null,
        notes: payload.notes?.trim()
          ? payload.notes.trim().slice(0, 500)
          : null,
        created_by: userId,
        updated_at: now
      },
      { onConflict: 'company_id,driver_id,plan_date' }
    )
    .select(
      `
      *,
      vehicle:vehicles(id, name, license_plate)
    `
    )
    .single();

  if (error) throw toQueryError(error);
  return mapPlanRow(
    data as Record<string, unknown> & { vehicle?: VehicleEmbed }
  );
}

/** Delete by id — RLS enforces company scope. */
export async function deleteDayPlan(planId: string): Promise<void> {
  const { supabase } = await requireAdminContext();
  const { error } = await supabase
    .from('driver_day_plans')
    .delete()
    .eq('id', planId);
  if (error) throw toQueryError(error);
}
