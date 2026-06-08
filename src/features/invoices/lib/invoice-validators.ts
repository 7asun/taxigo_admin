/**
 * invoice-validators.ts
 *
 * Validates individual invoice line items BEFORE the invoice is created.
 * Returns an array of warning codes — items with warnings are NOT blocked
 * from export; the user sees them flagged in step 3 (Positionen-Vorschau).
 *
 * Design principle: warnings are advisory, not blocking. The dispatcher
 * can still create the invoice but must acknowledge the warnings first.
 * This prevents a bad UX where one trip with missing data blocks the
 * entire monthly billing run.
 *
 * ─── Warning Codes ─────────────────────────────────────────────────────────
 *   missing_price     — unit_price is null or 0 (must be filled in step 3)
 *   missing_distance  — driving_distance_km is null (tax rate fallback used)
 *   zero_price        — unit_price is exactly 0 (unusual, shown as info)
 *   no_invoice_trip   — trip flagged no_invoice_required (soft advisory)
 * ──────────────────────────────────────────────────────────────────────────
 */

import type {
  BuilderLineItem,
  BuilderCancelledTripRow,
  LineItemWarning
} from '../types/invoice.types';
import { billingIncludedLineItems } from './billing-inclusion';

/**
 * Validates a single builder line item and returns an array of warning codes.
 * Returns an empty array if the item is fully valid.
 *
 * @param item - The line item to validate (before saving to DB).
 * @returns     Array of LineItemWarning codes. Empty = no issues.
 */
export function validateLineItem(item: BuilderLineItem): LineItemWarning[] {
  const warnings: LineItemWarning[] = [];

  if (item.no_invoice_warning) {
    warnings.push('no_invoice_trip');
  }

  // ── Price checks ───────────────────────────────────────────────────────────
  if (item.unit_price === null || item.unit_price === undefined) {
    // Dispatcher must enter a price manually in step 3
    warnings.push('missing_price');
  } else if (item.unit_price === 0 && !item.kts_override) {
    // Price of 0 is unusual (free ride?) — flag as info so it's not missed
    warnings.push('zero_price');
  }

  // ── Distance check ─────────────────────────────────────────────────────────
  if (item.distance_km === null || item.distance_km === undefined) {
    // Tax rate was defaulted to 7% as fallback — dispatcher should verify
    warnings.push('missing_distance');
  }

  return warnings;
}

/**
 * Validates all line items in a list and returns items with their warnings attached.
 * This is the main entry point used by the invoice builder in step 3.
 *
 * @param items - Line items before warnings are applied.
 * @returns      Same items with `.warnings` populated on each.
 */
export function validateLineItems(
  items: Omit<BuilderLineItem, 'warnings'>[]
): BuilderLineItem[] {
  return items.map((item) => {
    const itemWithWarnings: BuilderLineItem = { ...item, warnings: [] };
    itemWithWarnings.warnings = validateLineItem(itemWithWarnings);
    return itemWithWarnings;
  });
}

/**
 * Returns a human-readable German label for a warning code.
 * Used in badge tooltips in the line-items preview table.
 */
export function getWarningLabel(warning: LineItemWarning): string {
  switch (warning) {
    case 'missing_price':
      return 'Preis fehlt — bitte vor dem Erstellen eintragen';
    case 'missing_distance':
      return 'Fahrstrecke unbekannt — Steuersatz 7 % (Fallback)';
    case 'zero_price':
      return 'Preis ist 0 € — bitte prüfen';
    case 'no_invoice_trip':
      return 'Fahrt als „keine Rechnung“ markiert — bitte prüfen';
  }
}

/**
 * Returns true if ANY **billing-included** line item has a 'missing_price' warning.
 * Used to gate the "Rechnung erstellen" button in step 4.
 *
 * why: opted-out trips may lack prices but must not block Step 3 — they are not billed.
 */
export function hasMissingPrices(items: BuilderLineItem[]): boolean {
  return billingIncludedLineItems(items).some((item) =>
    item.warnings.includes('missing_price')
  );
}

/**
 * Returns true if any normal trip has been opted out without supplying a reason.
 * Gates the "Weiter zu PDF-Vorlage" button in Step 3.
 */
export function hasOptedOutTripWithoutReason(
  items: BuilderLineItem[]
): boolean {
  return items.some(
    (item) =>
      !item.billingInclusion.included &&
      item.billingInclusion.reason.trim().length === 0
  );
}

/**
 * Returns true if any cancelled trip has been opted in for billing without a billing reason.
 * Gates the "Weiter zu PDF-Vorlage" button in Step 3.
 */
export function hasOptedInCancelledWithoutReason(
  cancelledTrips: BuilderCancelledTripRow[]
): boolean {
  return cancelledTrips.some(
    (c) =>
      c.billingInclusion.included &&
      c.billingInclusion.reason.trim().length === 0
  );
}

/**
 * Combined guard: true when any inclusion reason is missing (opt-out without reason, or opt-in cancelled without reason).
 * Single call site for the Step 3 "Weiter" button gate.
 */
export function hasInclusionReasonErrors(
  items: BuilderLineItem[],
  cancelledTrips: BuilderCancelledTripRow[]
): boolean {
  return (
    hasOptedOutTripWithoutReason(items) ||
    hasOptedInCancelledWithoutReason(cancelledTrips)
  );
}
