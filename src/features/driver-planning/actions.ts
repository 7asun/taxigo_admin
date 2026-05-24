'use server';

/**
 * Thin server-action boundary for driver planning.
 * Delegates only to driver-planning.service — no data access here.
 */

import {
  deleteDayPlan,
  getCompanyWeekPlan,
  getDriverWeekPlan,
  getPlanningDrivers,
  upsertDayPlan
} from './api/driver-planning.service';
import type {
  DriverDayPlan,
  PlanningDriverListItem,
  UpsertDayPlanPayload
} from './types';

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
