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
};

/** Reconciliation row with confirmer display name for the summary bar. */
export type ShiftReconciliationWithMeta = ShiftReconciliation & {
  confirmer_name: string | null;
};

/** One row per calendar day from `get_shift_day_summaries` (list view / State B). */
export type ShiftDaySummary = {
  shift_date: string;
  total_trips: number;
  self_pay_count: number;
  self_pay_total: number;
  invoice_count: number;
  unconfigured_count: number;
  is_reconciled: boolean;
  reconciled_by_name: string | null;
  reconciled_at: string | null;
};

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
