/**
 * tax-calculator.ts
 *
 * ⚠️  ALL MwSt logic lives here and ONLY here.
 *     To change a rate or add a new rule → edit THIS file only.
 *     Never hardcode 0.07 or 0.19 anywhere else in the codebase.
 *
 * Legal basis: §12 Abs. 2 Nr. 10 UStG (Personenbeförderung)
 *   - Ermäßigter Steuersatz (7%)  for trips < 50 km
 *   - Regelsteuersatz (19%)        for trips ≥ 50 km
 *
 * ─── Future extension points ──────────────────────────────────────────────
 *   Before adding rules, add them ABOVE the distance check below:
 *   1. Vehicle type  — e.g. Rollstuhlfahrzeug may qualify for a different rate
 *   2. Service type  — billing_variant could carry a manual override rate
 *   3. Cross-border  — if Kostenträger is in another EU state → 0%
 * ──────────────────────────────────────────────────────────────────────────
 */

/** Available MwSt rates as decimal fractions. */
export const TAX_RATES = {
  REDUCED: 0.07, // 7%  — Ermäßigter Steuersatz
  STANDARD: 0.19 // 19% — Regelsteuersatz
} as const;

/** Trip distance threshold in km that determines which rate applies. */
export const DISTANCE_THRESHOLD_KM = 50;

/** Result of resolving the tax rate for a line item. */
export interface TaxRateResult {
  /** The resolved decimal tax rate (0.07 or 0.19). */
  rate: number;
  /**
   * 'exact'    — distance was present and above/below threshold → rate is certain
   * 'fallback' — distance was null; defaulted to REDUCED (7%) → show warning in UI
   */
  confidence: 'exact' | 'fallback';
}

/**
 * Resolves the applicable MwSt rate for a trip based on driving distance.
 *
 * @param distanceKm - Driving distance in km from `trips.driving_distance_km`.
 *                     Pass `null` if the distance is unknown.
 * @returns TaxRateResult with the resolved rate and a confidence indicator.
 *
 * @example
 *   resolveTaxRate(30)   // → { rate: 0.07, confidence: 'exact' }
 *   resolveTaxRate(75)   // → { rate: 0.19, confidence: 'exact' }
 *   resolveTaxRate(null) // → { rate: 0.07, confidence: 'fallback' }
 */
export function resolveTaxRate(distanceKm: number | null): TaxRateResult {
  // ── Future extension point 1: vehicle type check would go here ──────────
  // ── Future extension point 2: billing_variant override would go here ────

  if (distanceKm === null || distanceKm === undefined) {
    // Distance unknown → safe fallback to reduced rate (7%)
    // Caller should surface 'missing_distance' warning to the user
    return { rate: TAX_RATES.REDUCED, confidence: 'fallback' };
  }

  if (distanceKm >= DISTANCE_THRESHOLD_KM) {
    return { rate: TAX_RATES.STANDARD, confidence: 'exact' };
  }

  return { rate: TAX_RATES.REDUCED, confidence: 'exact' };
}

/**
 * Calculates tax amount from a net price and resolved rate.
 *
 * @param netPrice - Total net amount (Nettobetrag) for a group of items.
 * @param rate     - Tax rate as a decimal (0.07 or 0.19).
 * @returns Tax amount rounded to 2 decimal places.
 */
export function calculateTaxAmount(netPrice: number, rate: number): number {
  return Math.round(netPrice * rate * 100) / 100;
}

/**
 * Formats a tax rate decimal as a human-readable percentage string.
 *
 * @example formatTaxRate(0.07) // → "7 %"
 * @example formatTaxRate(0.19) // → "19 %"
 */
export function formatTaxRate(rate: number): string {
  return `${Math.round(rate * 100)} %`;
}
