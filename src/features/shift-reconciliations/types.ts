/**
 * Schichtzettel reconciliation — domain types and price/payer helpers.
 *
 * Self-pay resolution uses `resolveAcceptsSelfPayment` only (family tier then
 * payer) — do not read `payer.accepts_self_payment` or
 * `billing_type_accepts_self_payment` directly in UI; use the helpers below.
 *
 * `accepts_self_payment === null` after resolution means unconfigured and must
 * surface in the UI as a warning.
 */

import { resolveAcceptsSelfPayment } from '@/features/trips/lib/resolve-accepts-self-payment';

export type ReconciliationStatus = 'open' | 'completed';

export const RECONCILIATION_STATUS = {
  OPEN: 'open',
  COMPLETED: 'completed'
} as const satisfies Record<string, ReconciliationStatus>;

export type ShiftDayType = 'trips' | 'shift_only' | 'plan_only';

export type ShiftTrip = {
  id: string;
  scheduled_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  gross_price: number | null;
  manual_gross_price: number | null;
  /**
   * `billing_types.accepts_self_payment` when a row is joined; `undefined` when
   * `trips.billing_type_id` is null (no embed). `null` on the family row means
   * inherit from payer (same resolution as missing tier-1).
   */
  billing_type_accepts_self_payment: boolean | null | undefined;
  payer: {
    id: string;
    name: string;
    accepts_self_payment: boolean | null;
  };
};

export type ShiftReconciliation = {
  id: string;
  driver_id: string;
  date: string;
  confirmed_by: string;
  confirmed_at: string;
  notes: string | null;
  shift_id: string | null;
  status: ReconciliationStatus;
};

/** Reconciliation row with confirmer display name for the summary bar. */
export type ShiftReconciliationWithMeta = ShiftReconciliation & {
  confirmer_name: string | null;
};

/** One row per calendar day from `get_shift_day_summaries` (list view). */
export type ShiftDaySummary = {
  date: string;
  day_type: ShiftDayType;
  total_trips: number;
  selbstzahler_count: number;
  rechnung_count: number;
  total_revenue: number;
  shift_started_at: string | null;
  shift_ended_at: string | null;
  shift_break_minutes: number | null;
  shift_entered_by: string | null;
  reconciliation_status: ReconciliationStatus | null;
  plan_status: string | null;
};

export interface IstZeitRowProps {
  driverId: string;
  date: string;
  startedAt: string | null;
  endedAt: string | null;
  breakMinutes: number | null;
  totalRevenue: number | null;
  /**
   * WHY showIstZeit isolated here: Option B now (always true).
   * Option A: swap in driver.requires_shift_times without touching row rendering logic.
   * This is the ONLY place this flag lives (assignment is in shift-day-list.tsx).
   */
  showIstZeit: boolean;
  onSaved: () => void;
}

/**
 * Returns manual_gross_price when set, otherwise falls back to gross_price.
 * Use for display and sums — never read gross_price alone for “amount” semantics.
 */
export function getEffectivePrice(trip: ShiftTrip): number {
  return trip.manual_gross_price ?? trip.gross_price ?? 0;
}

function effectiveSelfPay(trip: ShiftTrip): boolean | null {
  return resolveAcceptsSelfPayment(
    trip.billing_type_accepts_self_payment,
    trip.payer.accepts_self_payment
  );
}

/** Selbstzahler when the resolved flag is explicitly true. */
export function isSelfPay(trip: ShiftTrip): boolean {
  return effectiveSelfPay(trip) === true;
}

/** Rechnung when the resolved flag is explicitly false. */
export function isInvoiceTrip(trip: ShiftTrip): boolean {
  return effectiveSelfPay(trip) === false;
}

/** True when neither family (when present) nor payer fixes Selbstzahler vs Rechnung. */
export function isUnconfiguredPayer(trip: ShiftTrip): boolean {
  return effectiveSelfPay(trip) === null;
}

/** Shift row has incomplete times (partial entry blocks Abschließen). */
export function isShiftTimeIncomplete(summary: ShiftDaySummary): boolean {
  const hasStart = summary.shift_started_at != null;
  const hasEnd = summary.shift_ended_at != null;
  if (!hasStart && !hasEnd) return false;
  return hasStart !== hasEnd;
}
