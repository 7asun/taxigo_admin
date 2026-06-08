/**
 * Schichtzettel reconciliation — server-only Supabase access.
 *
 * updateTripManualPrice updates manual_gross_price only and does not call
 * tripsService.updateTrip, so the price engine does not recompute or overwrite
 * the admin’s paper-journal override.
 *
 * Shifts row lookup in completeReconciliation is best-effort: `shifts` is
 * driver-owned and may be absent for a date — reconciliation must still succeed
 * with shift_id null.
 */

import { createAdminShiftForDriver } from '@/features/driver-planning/api/admin-shifts.service';
import { getZonedDayBoundsIso } from '@/features/trips/lib/trip-business-date';
import { createClient } from '@/lib/supabase/server';
import { toQueryError } from '@/lib/supabase/to-query-error';
import { breakMinutesToPair } from '../lib/time-helpers';
import { SHIFT_RECONCILIATION_TRIP_STATUS } from '../lib/constants';
import {
  RECONCILIATION_STATUS,
  type ReconciliationStatus,
  type ShiftDaySummary,
  type ShiftDayType,
  type ShiftReconciliationWithMeta,
  type ShiftTrip
} from '../types';

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

export type DriverListItem = { id: string; full_name: string };

/**
 * All active drivers in the current admin’s company (for the driver selector).
 */
export async function getDrivers(): Promise<DriverListItem[]> {
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

type TripPayerRow = {
  id: string;
  name: string;
  accepts_self_payment: boolean | null;
} | null;

type BillingTypeEmbedRow = { accepts_self_payment: boolean | null } | null;

type TripQueryRow = {
  id: string;
  scheduled_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  gross_price: number | null;
  manual_gross_price: number | null;
  billing_type: BillingTypeEmbedRow | BillingTypeEmbedRow[] | null;
  payers: TripPayerRow | TripPayerRow[] | null;
};

function mapBillingTypeAcceptsSelfPayment(
  raw: BillingTypeEmbedRow | BillingTypeEmbedRow[] | null | undefined
): boolean | null | undefined {
  const embed = Array.isArray(raw) ? raw[0] : raw;
  if (embed == null) return undefined;
  return embed.accepts_self_payment;
}

/**
 * Trips for a driver on a business-calendar day, status assigned, with payer self-pay flag.
 */
export async function getTripsForShift(
  driverId: string,
  date: string
): Promise<ShiftTrip[]> {
  const { supabase, companyId } = await requireAdminContext();
  const { startISO, endExclusiveISO } = getZonedDayBoundsIso(date);

  const { data, error } = await supabase
    .from('trips')
    .select(
      `
      id,
      scheduled_at,
      pickup_address,
      dropoff_address,
      gross_price,
      manual_gross_price,
      billing_type:billing_types!trips_billing_type_id_fkey (
        accepts_self_payment
      ),
      payers!trips_payer_id_fkey (
        id,
        name,
        accepts_self_payment
      )
    `
    )
    .eq('company_id', companyId)
    .eq('driver_id', driverId)
    .eq('status', SHIFT_RECONCILIATION_TRIP_STATUS)
    .gte('scheduled_at', startISO)
    .lt('scheduled_at', endExclusiveISO)
    .order('scheduled_at', { ascending: true });

  if (error) throw toQueryError(error);
  const rows = (data ?? []) as unknown as TripQueryRow[];
  return rows.map((row) => {
    const rawP = row.payers;
    const p = Array.isArray(rawP) ? (rawP[0] ?? null) : rawP;
    return {
      id: row.id,
      scheduled_at: row.scheduled_at,
      pickup_address: row.pickup_address,
      dropoff_address: row.dropoff_address,
      gross_price: row.gross_price,
      manual_gross_price: row.manual_gross_price,
      billing_type_accepts_self_payment: mapBillingTypeAcceptsSelfPayment(
        row.billing_type
      ),
      payer: p
        ? {
            id: p.id,
            name: p.name,
            accepts_self_payment: p.accepts_self_payment
          }
        : {
            id: '',
            name: '—',
            accepts_self_payment: null
          }
    };
  });
}

/**
 * Direct write of manual override only — bypasses pricing engine.
 */
export async function updateTripManualPrice(
  tripId: string,
  manualGrossPrice: number | null
): Promise<void> {
  const { supabase, companyId } = await requireAdminContext();

  const { data: trip, error: fetchError } = await supabase
    .from('trips')
    .select('id, company_id')
    .eq('id', tripId)
    .maybeSingle();
  if (fetchError) throw toQueryError(fetchError);
  if (!trip || trip.company_id !== companyId) {
    throw new Error('Forbidden');
  }

  const { error } = await supabase
    .from('trips')
    .update({ manual_gross_price: manualGrossPrice })
    .eq('id', tripId);
  if (error) throw toQueryError(error);
}

export type CompleteReconciliationParams = {
  driverId: string;
  date: string;
  notes?: string;
};

async function findShiftForReconciliation(
  supabase: AdminContext['supabase'],
  companyId: string,
  driverId: string,
  date: string
): Promise<{ id: string; started_at: string; ended_at: string | null } | null> {
  const { startISO, endExclusiveISO } = getZonedDayBoundsIso(date);
  const { data, error } = await supabase
    .from('shifts')
    .select('id, started_at, ended_at')
    .eq('driver_id', driverId)
    .eq('company_id', companyId)
    .gte('started_at', startISO)
    .lt('started_at', endExclusiveISO)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw toQueryError(error);
  return data;
}

/**
 * Marks reconciliation completed for (company, driver, date). Resolves shift_id when present.
 */
export async function completeReconciliation(
  params: CompleteReconciliationParams
): Promise<void> {
  const { supabase, companyId, userId } = await requireAdminContext();

  let shiftId: string | null = null;
  try {
    const shift = await findShiftForReconciliation(
      supabase,
      companyId,
      params.driverId,
      params.date
    );

    // WHY D1 Option B: empty Row 1 is allowed (not all drivers are hourly);
    // only partial entries are blocked when a shift row exists.
    if (shift && shift.ended_at == null) {
      throw new Error('IST_ZEIT_INCOMPLETE');
    }

    shiftId = shift?.id ?? null;
  } catch (err) {
    if (err instanceof Error && err.message === 'IST_ZEIT_INCOMPLETE') {
      throw err;
    }
    shiftId = null;
  }

  const { error } = await supabase.from('shift_reconciliations').upsert(
    {
      company_id: companyId,
      driver_id: params.driverId,
      date: params.date,
      confirmed_by: userId,
      confirmed_at: new Date().toISOString(),
      notes: params.notes?.trim() ? params.notes.trim() : null,
      shift_id: shiftId,
      status: RECONCILIATION_STATUS.COMPLETED
    },
    { onConflict: 'company_id,driver_id,date' }
  );
  if (error) throw toQueryError(error);
}

/**
 * WHY D2: admin correction after completion; confirmed_by updated for audit trail.
 */
export async function reopenReconciliation(
  driverId: string,
  date: string
): Promise<void> {
  const { supabase, companyId, userId } = await requireAdminContext();

  const { data, error } = await supabase
    .from('shift_reconciliations')
    .update({
      status: RECONCILIATION_STATUS.OPEN,
      confirmed_by: userId,
      confirmed_at: new Date().toISOString()
    })
    .eq('company_id', companyId)
    .eq('driver_id', driverId)
    .eq('date', date)
    .select('id')
    .maybeSingle();

  if (error) throw toQueryError(error);
  if (!data) throw new Error('RECONCILIATION_NOT_FOUND');
}

export type SaveIstZeitInlineParams = {
  driverId: string;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
};

/**
 * Inline Row 1 save — reuses admin shift upsert (entered_by, Berlin bounds, unique index).
 */
export async function saveIstZeitInline(
  params: SaveIstZeitInlineParams
): Promise<void> {
  if (!params.startTime.trim() || !params.endTime.trim()) {
    throw new Error('IST_ZEIT_INCOMPLETE');
  }

  const breaks = breakMinutesToPair(
    params.startTime,
    params.endTime,
    params.breakMinutes
  );

  await createAdminShiftForDriver({
    driverId: params.driverId,
    date: params.date,
    startTime: params.startTime,
    endTime: params.endTime,
    breaks
  });
}

/**
 * Latest reconciliation for driver+date with confirmer display name.
 */
export async function getReconciliation(
  driverId: string,
  date: string
): Promise<ShiftReconciliationWithMeta | null> {
  const { supabase, companyId } = await requireAdminContext();

  const { data: row, error } = await supabase
    .from('shift_reconciliations')
    .select(
      'id, driver_id, date, confirmed_by, confirmed_at, notes, shift_id, status'
    )
    .eq('company_id', companyId)
    .eq('driver_id', driverId)
    .eq('date', date)
    .maybeSingle();

  if (error) throw toQueryError(error);
  if (!row) return null;

  const { data: confirmer } = await supabase
    .from('accounts')
    .select('name, first_name, last_name')
    .eq('id', row.confirmed_by)
    .maybeSingle();

  return {
    id: row.id,
    driver_id: row.driver_id,
    date: row.date,
    confirmed_by: row.confirmed_by,
    confirmed_at: row.confirmed_at,
    notes: row.notes,
    shift_id: row.shift_id,
    status: row.status as ReconciliationStatus,
    confirmer_name: confirmer ? displayDriverName(confirmer) : null
  };
}

function parseReconciliationStatus(raw: unknown): ReconciliationStatus | null {
  if (raw === RECONCILIATION_STATUS.OPEN) return RECONCILIATION_STATUS.OPEN;
  if (raw === RECONCILIATION_STATUS.COMPLETED) {
    return RECONCILIATION_STATUS.COMPLETED;
  }
  return null;
}

function parseDayType(raw: unknown): ShiftDayType {
  if (raw === 'shift_only' || raw === 'plan_only' || raw === 'trips') {
    return raw;
  }
  return 'trips';
}

function mapRpcShiftDaySummary(row: Record<string, unknown>): ShiftDaySummary {
  return {
    date: String(row.date),
    day_type: parseDayType(row.day_type),
    total_trips: Number(row.total_trips),
    selbstzahler_count: Number(row.selbstzahler_count),
    rechnung_count: Number(row.rechnung_count),
    total_revenue: Number(row.total_revenue),
    shift_started_at:
      row.shift_started_at == null ? null : String(row.shift_started_at),
    shift_ended_at:
      row.shift_ended_at == null ? null : String(row.shift_ended_at),
    shift_break_minutes:
      row.shift_break_minutes == null ? null : Number(row.shift_break_minutes),
    shift_entered_by:
      row.shift_entered_by == null ? null : String(row.shift_entered_by),
    reconciliation_status: parseReconciliationStatus(row.reconciliation_status),
    plan_status: row.plan_status == null ? null : String(row.plan_status)
  };
}

/**
 * Aggregated days for the list view — `get_shift_day_summaries` RPC only; do not
 * re-aggregate full trip rows in JS for this screen.
 */
export async function getShiftDaySummaries(
  driverId: string
): Promise<ShiftDaySummary[]> {
  const { supabase, companyId } = await requireAdminContext();
  const { data, error } = await supabase.rpc('get_shift_day_summaries', {
    p_driver_id: driverId,
    p_company_id: companyId
  });
  if (error) throw toQueryError(error);
  const rows = (data ?? []) as Record<string, unknown>[];
  return rows.map(mapRpcShiftDaySummary);
}

/** @deprecated Use completeReconciliation */
export const confirmShift = completeReconciliation;
/** @deprecated Use CompleteReconciliationParams */
export type ConfirmShiftParams = CompleteReconciliationParams;
