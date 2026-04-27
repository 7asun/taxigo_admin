'use server';

/**
 * Thin server-action boundary for Schichtzettel reconciliation.
 * Delegates only to shift-reconciliations.service — no data access here
 * (see project plan / docs/SUPABASE_INTEGRATION.md).
 */

import type {
  ConfirmShiftParams,
  DriverListItem
} from './api/shift-reconciliations.service';
import {
  confirmShift,
  getDrivers,
  getReconciliation,
  getShiftDaySummaries,
  getTripsForShift,
  updateTripManualPrice
} from './api/shift-reconciliations.service';
import type {
  ShiftDaySummary,
  ShiftReconciliationWithMeta,
  ShiftTrip
} from './types';

export async function getShiftReconciliationDriversAction(): Promise<
  DriverListItem[]
> {
  return getDrivers();
}

export async function getShiftTripsForDateAction(
  driverId: string,
  date: string
): Promise<ShiftTrip[]> {
  return getTripsForShift(driverId, date);
}

export async function getShiftReconciliationRecordAction(
  driverId: string,
  date: string
): Promise<ShiftReconciliationWithMeta | null> {
  return getReconciliation(driverId, date);
}

export async function getShiftDaySummariesAction(
  driverId: string
): Promise<ShiftDaySummary[]> {
  return getShiftDaySummaries(driverId);
}

export async function updateTripManualPriceAction(
  tripId: string,
  manualGrossPrice: number | null
): Promise<void> {
  return updateTripManualPrice(tripId, manualGrossPrice);
}

export async function confirmShiftReconciliationAction(
  params: ConfirmShiftParams
): Promise<void> {
  return confirmShift(params);
}
