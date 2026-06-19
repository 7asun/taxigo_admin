/**
 * TripRow — the shape that inline table cells and trip-domain helpers operate on.
 *
 * Matches the Supabase query embed used in trips-listing.tsx:
 *   payer:payers(name, reha_schein_enabled)
 *
 * WHY a dedicated types file: the shape was previously inlined inside
 * `inline-cells/kts-cells.tsx` (a React client component). Extracting it here
 * lets pure lib helpers (e.g. trip-assignment-flags.ts) import the type without
 * pulling in React or any client-component dependencies, keeping them testable
 * as plain TypeScript modules.
 */

import type { Trip } from '@/features/trips/api/trips.service';

/** Aligns with list/kanban payer embed (`name`, `reha_schein_enabled`). */
export type TripRow = Trip & {
  payer: { name: string; reha_schein_enabled: boolean } | null;
};
