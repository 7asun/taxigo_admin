'use server';

/**
 * Thin server-action boundary for Schichtzettel reconciliation.
 * Delegates only to shift-reconciliations.service — no data access here
 * (see project plan / docs/SUPABASE_INTEGRATION.md).
 */

import { revalidatePath } from 'next/cache';
import type {
  CompleteReconciliationParams,
  DriverListItem,
  SaveIstZeitInlineParams
} from './api/shift-reconciliations.service';
import {
  completeReconciliation,
  getDrivers,
  getReconciliation,
  getShiftDaySummaries,
  getTripsForShift,
  reopenReconciliation,
  saveIstZeitInline,
  updateTripManualPrice
} from './api/shift-reconciliations.service';
import type {
  ShiftDaySummary,
  ShiftReconciliationWithMeta,
  ShiftTrip
} from './types';

const RECONCILIATIONS_PATH = '/dashboard/shift-reconciliations';

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

export async function completeReconciliationAction(
  params: CompleteReconciliationParams
): Promise<
  { success: true } | { success: false; error: string; message?: string }
> {
  try {
    await completeReconciliation(params);
    revalidatePath(RECONCILIATIONS_PATH);
    return { success: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'IST_ZEIT_INCOMPLETE') {
      return {
        success: false,
        error: 'IST_ZEIT_INCOMPLETE',
        message: 'Beginn oder Ende fehlt. Bitte Ist-Zeiten vervollständigen.'
      };
    }
    return {
      success: false,
      error: 'UNKNOWN',
      message: err instanceof Error ? err.message : 'Unbekannter Fehler'
    };
  }
}

export async function reopenReconciliationAction(
  driverId: string,
  date: string
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await reopenReconciliation(driverId, date);
    revalidatePath(RECONCILIATIONS_PATH);
    return { success: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'RECONCILIATION_NOT_FOUND') {
      return { success: false, error: 'NOT_FOUND' };
    }
    return { success: false, error: 'UNKNOWN' };
  }
}

export async function saveIstZeitInlineAction(
  params: SaveIstZeitInlineParams
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await saveIstZeitInline(params);
    revalidatePath(RECONCILIATIONS_PATH);
    revalidatePath('/dashboard/fahrerschichtplanung');
    return { success: true };
  } catch (err) {
    if (err instanceof Error && err.message === 'IST_ZEIT_INCOMPLETE') {
      return { success: false, error: 'IST_ZEIT_INCOMPLETE' };
    }
    if (err instanceof Error && err.message === 'ACTIVE_SHIFT_BLOCKED') {
      return { success: false, error: 'ACTIVE_SHIFT_BLOCKED' };
    }
    return { success: false, error: 'UNKNOWN' };
  }
}
