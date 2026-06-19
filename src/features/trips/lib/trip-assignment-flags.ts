/**
 * Pure, side-effect-free helpers for trip-level assignment-flag state.
 *
 * WHY a separate file from kts-filter.ts:
 *   `kts-filter.ts` owns the *URL contract* — which tokens are valid, how to
 *   parse them, and how to translate them into Supabase query conditions.
 *   This module answers a different question: given a trip row that is already
 *   in memory, which flag combinations are worth surfacing to the admin?
 *   Keeping the two concerns in separate files prevents a lib helper that reads
 *   a boolean from accidentally taking on URL-parsing or PostgREST semantics.
 *
 * Rules:
 *   - No React imports.
 *   - No side effects.
 *   - Each function is the single source of truth for its rule.
 *     If the business logic for that rule changes, it changes here and nowhere else.
 */

import type { TripRow } from '@/features/trips/types/trip-row';

/**
 * Returns true when a trip has both KTS and Reha-Schein assigned simultaneously.
 *
 * This combination is unusual in practice: KTS (Krankentransportschein) and
 * Reha-Schein represent different document types and billing paths. When both
 * are active on the same trip, the admin team should be notified so they can
 * review whether the assignment is intentional.
 */
export function hasKtsRehaOverlap(trip: TripRow): boolean {
  return trip.kts_document_applies === true && trip.reha_schein === true;
}
