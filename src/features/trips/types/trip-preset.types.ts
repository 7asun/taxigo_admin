import type { Database } from '@/types/database.types';

/**
 * A saved workspace preset: named combination of filter params,
 * column visibility, and column order. Applied atomically on activation.
 */
export type TripPreset = Database['public']['Tables']['trip_presets']['Row'];

export type TripPresetInsert =
  Database['public']['Tables']['trip_presets']['Insert'];

export type TripPresetUpdate =
  Database['public']['Tables']['trip_presets']['Update'];

/**
 * Params stored in a preset — mirrors URL search param keys in
 * `src/lib/searchparams.ts` / trips filters. Pagination is never stored.
 */
export type TripPresetParams = {
  search?: string;
  status?: string;
  driver_id?: string;
  payer_id?: string;
  billing_variant_id?: string;
  invoice_status?: string;
  scheduled_at?: string;
  sort?: string;
  view?: string;
};

/** Whitelist for serializing URL → preset params (avoids stray keys). */
export const TRIP_PRESET_PARAM_KEYS = [
  'search',
  'status',
  'driver_id',
  'payer_id',
  'billing_variant_id',
  'invoice_status',
  'scheduled_at',
  'sort',
  'view'
] as const satisfies readonly (keyof TripPresetParams)[];

export function isTripPresetParamKey(
  key: string
): key is keyof TripPresetParams {
  return (TRIP_PRESET_PARAM_KEYS as readonly string[]).includes(key);
}

/** Stable string for comparing two param objects (sorted keys). */
export function stableParamsJson(params: TripPresetParams): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v != null && String(v) !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(entries));
}

/** Stable string for comparing VisibilityState-like objects. */
export function stableVisibilityJson(
  visibility: Record<string, boolean>
): string {
  const entries = Object.entries(visibility).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return JSON.stringify(Object.fromEntries(entries));
}
