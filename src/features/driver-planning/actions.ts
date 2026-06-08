'use server';

/**
 * Thin server-action boundary for driver planning.
 * Delegates only to driver-planning.service — no data access here.
 */

import { reopenReconciliationAction } from '@/features/shift-reconciliations/actions';
import {
  createAdminShiftForDriver,
  deleteAdminShift,
  getAdminShiftForDriverDate
} from './api/admin-shifts.service';
import {
  deleteDayPlan,
  getCompanyWeekPlan,
  getDriverWeekPlan,
  getPlanningDrivers,
  upsertDayPlan
} from './api/driver-planning.service';
import type {
  AdminShiftForDate,
  CreateAdminShiftPayload,
  DriverDayPlan,
  PlanningDriverListItem,
  UpsertDayPlanPayload
} from './types';
import { revalidatePath } from 'next/cache';

export async function getPlanningDriversAction(): Promise<
  PlanningDriverListItem[]
> {
  return getPlanningDrivers();
}

export async function getDriverWeekPlanAction(
  driverId: string,
  weekStartYmd: string
): Promise<DriverDayPlan[]> {
  return getDriverWeekPlan(driverId, weekStartYmd);
}

export async function getCompanyWeekPlanAction(
  weekStartYmd: string
): Promise<DriverDayPlan[]> {
  return getCompanyWeekPlan(weekStartYmd);
}

export async function upsertDayPlanAction(
  payload: UpsertDayPlanPayload
): Promise<DriverDayPlan> {
  return upsertDayPlan(payload);
}

export async function deleteDayPlanAction(planId: string): Promise<void> {
  return deleteDayPlan(planId);
}

export async function getAdminShiftForDriverDateAction(
  driverId: string,
  date: string
): Promise<AdminShiftForDate | null> {
  return getAdminShiftForDriverDate(driverId, date);
}

export async function createAdminShiftAction(
  params: CreateAdminShiftPayload
): Promise<
  { success: true; shiftId: string } | { success: false; error: string }
> {
  try {
    const { shiftId } = await createAdminShiftForDriver(params);
    revalidatePath('/dashboard/fahrerschichtplanung');
    return { success: true, shiftId };
  } catch (err) {
    if (err instanceof Error && err.message === 'ACTIVE_SHIFT_BLOCKED') {
      return { success: false, error: 'ACTIVE_SHIFT_BLOCKED' };
    }
    return { success: false, error: 'UNKNOWN' };
  }
}

export async function deleteAdminShiftAction(
  driverId: string,
  date: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await deleteAdminShift(driverId, date);
    revalidatePath('/dashboard/shift-reconciliations');
    revalidatePath('/dashboard/fahrerschichtplanung');

    const reopenResult = await reopenReconciliationAction(driverId, date);
    if (!reopenResult.success && reopenResult.error !== 'NOT_FOUND') {
      // Delete succeeded; reopen is best-effort for completed reconciliations.
    }

    return { success: true };
  } catch {
    return { success: false, error: 'UNKNOWN' };
  }
}
