/**
 * price-calculator.ts
 *
 * Resolves the billable price and quantity for a trip when building
 * line items. Handles the price precedence hierarchy:
 *
 *   1. Client price_tag (HIGHEST PRIORITY)
 *      - Set at client level as BRUTTO (gross price including tax)
 *      - Automatically converted to NETTO for invoice line items
 *      - Overrides any manually entered trip price
 *
 *   2. Manual price (FALLBACK)
 *      - Driver or dispatcher entered `trips.price` directly as NETTO
 *      - Only used when client has no price_tag
 *      - quantity = 1, unit_price = trips.price
 *
 *   3. Per-km rate (FUTURE — Phase 2+)
 *      - Rate card price per km stored in `payer_rate_cards` table
 *      - quantity = distance_km, unit_price = price_per_km
 *
 * ─── Price Precedence Hierarchy ────────────────────────────────────────────
 * The resolveTripPrice function follows this strict order:
 *   1. If client.price_tag exists → convert from brutto to netto (primary source)
 *   2. Else if trips.price exists → use it directly as netto (fallback)
 *   3. Else → return null (requires manual entry during invoicing)
 *
 * ─── Brutto to Netto Conversion ───────────────────────────────────────────
 * Clients.price_tag is stored as BRUTTO (gross price including VAT).
 * For invoice line items, we need NETTO prices since tax is calculated separately.
 *
 *   netto = brutto / (1 + tax_rate)
 *
 * Example: price_tag = 25.00 € (brutto), tax_rate = 0.19
 *   netto = 25.00 / 1.19 = 21.01 €
 *   tax   = 21.01 × 0.19 = 3.99 €
 *   brutto = 25.00 € ✓
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { TripForInvoice } from '../types/invoice.types';

/** Result of resolving the price for a single trip. */
export interface PriceResult {
  unitPrice: number | null; // null = price is missing (shows warning in builder)
  quantity: number; // 1 for manual pricing; distanceKm for per-km
  totalPrice: number | null; // unitPrice * quantity; null if unitPrice is null
  /** Indicates which price source was used for this trip. */
  source: 'client_price_tag' | 'trip_price' | null;
}

/**
 * Resolves the billable price for a trip following the precedence hierarchy.
 *
 * Price resolution follows strict hierarchy (highest to lowest):
 *   1. client.price_tag — stored as BRUTTO, converted to NETTO for line items
 *   2. trips.price — already stored as NETTO, used directly
 *   3. null — no price available, requires manual entry during invoicing
 *
 * @param trip     - The source trip row with price and client fields.
 * @param taxRate  - Tax rate for this trip (0.07 or 0.19), needed to convert
 *                   client.price_tag from brutto to netto.
 * @param rateCard - (Future) per-km rate card. Pass null to use manual price.
 * @returns         PriceResult with unit price, quantity, computed total, and source.
 */
export function resolveTripPrice(
  trip: Pick<TripForInvoice, 'price' | 'driving_distance_km' | 'client'>,
  // Tax rate needed to convert client.price_tag from brutto to netto
  taxRate: number,
  // ── Extension point: add rateCard type here when rate cards are built ──
  rateCard: null = null
): PriceResult {
  // ── Future: per-km rate card pricing ──────────────────────────────────
  // if (rateCard && trip.driving_distance_km !== null) {
  //   const quantity = trip.driving_distance_km;
  //   const unitPrice = rateCard.price_per_km;
  //   return { unitPrice, quantity, totalPrice: unitPrice * quantity, source: 'rate_card' };
  // }

  // Suppress unused warning until rateCard is implemented
  void rateCard;

  // ── HIGHEST PRIORITY: Client price_tag ─────────────────────────────────
  // clients.price_tag is stored as BRUTTO (gross price including tax).
  // For invoice line items, we need NETTO since tax is calculated separately.
  // Conversion: netto = brutto / (1 + tax_rate)
  if (trip.client?.price_tag !== null && trip.client?.price_tag !== undefined) {
    const bruttoPrice = trip.client.price_tag;
    // Convert from brutto to netto: divide by (1 + tax_rate)
    const nettoPrice = bruttoPrice / (1 + taxRate);
    const quantity = 1;
    return {
      unitPrice: nettoPrice,
      quantity,
      totalPrice: nettoPrice * quantity,
      source: 'client_price_tag'
    };
  }

  // ── FALLBACK: Manual price from trips.price ────────────────────────────
  // trips.price is already stored as NETTO (no conversion needed)
  const unitPrice = trip.price ?? null;
  const quantity = 1;

  return {
    unitPrice,
    quantity,
    totalPrice: unitPrice !== null ? unitPrice * quantity : null,
    source: unitPrice !== null ? 'trip_price' : null
  };
}
