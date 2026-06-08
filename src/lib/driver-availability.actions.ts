'use server';

/**
 * Thin server-action boundary for driver availability reads.
 * All logic lives in driver-availability.ts.
 */

import type { DriverDayContext, ShiftSummary } from '@/lib/driver-availability';
import {
  getActiveDriversDayContext,
  getCompanyWeekShiftsMap,
  getDriverDayContext,
  getDriversDayContext
} from '@/lib/driver-availability.server';
import { serializeCompanyWeekShiftsMap } from '@/lib/driver-availability';

export async function getDriverDayContextAction(
  driverId: string,
  dateYmd: string
): Promise<DriverDayContext> {
  return getDriverDayContext(driverId, dateYmd);
}

export async function getDriversDayContextAction(
  driverIds: string[],
  dateYmd: string
): Promise<DriverDayContext[]> {
  return getDriversDayContext(driverIds, dateYmd);
}

export async function getActiveDriversDayContextAction(
  dateYmd: string
): Promise<DriverDayContext[]> {
  return getActiveDriversDayContext(dateYmd);
}

export async function getCompanyWeekShiftsMapAction(
  weekStartYmd: string
): Promise<Record<string, Record<string, ShiftSummary>>> {
  const map = await getCompanyWeekShiftsMap(weekStartYmd);
  return serializeCompanyWeekShiftsMap(map);
}
