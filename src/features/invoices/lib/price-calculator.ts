/**
 * price-calculator.ts
 *
 * Resolves the billable price and quantity for a trip when building
 * line items. Handles two pricing models:
 *
 *   1. Manual price  — dispatcher or driver entered `trips.price` directly.
 *                      quantity = 1, unit_price = trips.price
 *
 *   2. Per-km rate   — (FUTURE — Phase 2+) apply a rate card price per km.
 *                      quantity = distance_km, unit_price = price_per_km
 *                      Rate cards will be stored in `payer_rate_cards` table.
 *
 * ─── Extension point ─────────────────────────────────────────────────────
 * When per-km rate cards are implemented:
 *   1. Add a `rateCard` parameter here (nullable — null = fall back to manual)
 *   2. If rateCard is present: return { unitPrice: rateCard.pricePerKm, quantity: distanceKm }
 *   3. The tax-calculator is independent — it still runs on distanceKm regardless
 * ─────────────────────────────────────────────────────────────────────────
 */

import type { TripForInvoice } from '../types/invoice.types';

/** Result of resolving the price for a single trip. */
export interface PriceResult {
  unitPrice: number | null; // null = price is missing (shows warning in builder)
  quantity: number; // 1 for manual pricing; distanceKm for per-km
  totalPrice: number | null; // unitPrice * quantity; null if unitPrice is null
}

/**
 * Resolves the billable price for a trip.
 *
 * Currently only the manual-price model is supported.
 * The function signature is designed to accept a future rate card parameter.
 *
 * @param trip     - The source trip row with price and distance fields.
 * @param rateCard - (Future) per-km rate card. Pass null to use manual price.
 * @returns         PriceResult with unit price, quantity, and computed total.
 */
export function resolveTripPrice(
  trip: Pick<TripForInvoice, 'price' | 'driving_distance_km'>,
  // ── Extension point: add rateCard type here when rate cards are built ──
  rateCard: null = null
): PriceResult {
  // ── Future: per-km rate card pricing ──────────────────────────────────
  // if (rateCard && trip.driving_distance_km !== null) {
  //   const quantity = trip.driving_distance_km;
  //   const unitPrice = rateCard.price_per_km;
  //   return { unitPrice, quantity, totalPrice: unitPrice * quantity };
  // }

  // Suppress unused warning until rateCard is implemented
  void rateCard;

  // ── Current: manual price from trips.price ─────────────────────────────
  const unitPrice = trip.price ?? null;
  const quantity = 1;

  return {
    unitPrice,
    quantity,
    totalPrice: unitPrice !== null ? unitPrice * quantity : null
  };
}
