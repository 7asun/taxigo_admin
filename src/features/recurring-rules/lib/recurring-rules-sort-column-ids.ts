/**
 * Sortable column ids + shared pagination constants for Alle Regelfahrten.
 * Lives in a non-client module so the RSC page can safely import these values
 * without crossing the `'use client'` boundary (that boundary can replace
 * exports with stubs and silently turn numeric constants into `undefined`,
 * causing NaN in `Math.max/min` and an empty pageRows slice).
 */

/** Default page size; must stay aligned with `useDataTable` URL defaults. */
export const RECURRING_RULES_TABLE_DEFAULT_PAGE_SIZE = 50;

export const RECURRING_RULES_SORT_COLUMN_IDS = new Set([
  'client_name',
  'days',
  'pickup_time',
  'pickup_address',
  'dropoff_address',
  'return_mode',
  'billing',
  'is_active',
  'start_date'
]);
