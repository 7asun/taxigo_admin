/**
 * Google Maps Directions API (server-side only).
 *
 * Exports two functions:
 *   - `getDrivingMetrics`            — raw Google Directions call, use only when you explicitly
 *                                       want to bypass the cache (e.g. forced refresh).
 *   - `resolveDrivingMetricsWithCache` — preferred entry point for all callers. Checks the
 *                                       `trips` table for an existing row with identical
 *                                       lat/lng before hitting Google.
 *
 * `GOOGLE_MAPS_API_KEY` is not exposed to the browser. Do **not** import this module from
 * `'use client'` components — use `@/features/trips/lib/fetch-driving-metrics` (POST
 * `/api/trips/driving-metrics`) instead. Route Handlers, cron jobs, and Node scripts may
 * import directly from this module.
 *
 * @see docs/driving-metrics-api.md
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';

const DIRECTIONS_ENDPOINT =
  'https://maps.googleapis.com/maps/api/directions/json';

interface DirectionsLegDistance {
  value: number;
  text: string;
}

interface DirectionsLegDuration {
  value: number;
  text: string;
}

interface DirectionsLeg {
  distance?: DirectionsLegDistance;
  duration?: DirectionsLegDuration;
}

interface DirectionsRoute {
  legs?: DirectionsLeg[];
}

interface DirectionsResponse {
  status?: string;
  routes?: DirectionsRoute[];
}

/** Driving distance and duration as returned by the Google Directions API. */
export interface DrivingMetrics {
  distanceKm: number;
  durationSeconds: number;
}

/**
 * Makes a live call to the Google Directions API.
 *
 * Prefer `resolveDrivingMetricsWithCache` for all normal use cases — this function
 * is intentionally low-level and skips the DB cache. Safe only in environments
 * where `process.env.GOOGLE_MAPS_API_KEY` is set (server / Node scripts).
 */
export async function getDrivingMetrics(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<DrivingMetrics | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    console.error('GOOGLE_MAPS_API_KEY is not set');
    return null;
  }

  const origin = `${originLat},${originLng}`;
  const destination = `${destLat},${destLng}`;

  const url = new URL(DIRECTIONS_ENDPOINT);
  url.searchParams.set('origin', origin);
  url.searchParams.set('destination', destination);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('units', 'metric');
  url.searchParams.set('key', apiKey);

  try {
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) {
      console.error('Directions API HTTP error', res.status, res.statusText);
      return null;
    }

    const data = (await res.json()) as DirectionsResponse;

    if (data.status && data.status !== 'OK') {
      console.error('Directions API status error', data.status);
      return null;
    }

    const firstRoute = data.routes?.[0];
    const firstLeg = firstRoute?.legs?.[0];
    const distanceMeters = firstLeg?.distance?.value;
    const durationSeconds = firstLeg?.duration?.value;

    if (
      typeof distanceMeters !== 'number' ||
      typeof durationSeconds !== 'number'
    ) {
      console.error('Directions API missing distance or duration');
      return null;
    }

    const distanceKm = distanceMeters / 1000;

    return {
      distanceKm,
      durationSeconds
    };
  } catch (error) {
    console.error('Error calling Directions API', error);
    return null;
  }
}

/**
 * Extends `DrivingMetrics` with a `source` field so callers can observe whether
 * the values came from the DB cache or a fresh Google Directions call.
 * Useful for monitoring quota usage and debugging.
 */
export interface ResolvingMetrics extends DrivingMetrics {
  source: 'cache' | 'google';
}

/**
 * Resolves driving distance and duration for a route, using a two-tier lookup:
 *
 *   1. **DB cache** — queries `trips` for any existing row with identical
 *      pickup/dropoff coordinates that already has `driving_distance_km` populated.
 *      Returns those values immediately without touching Google.
 *
 *   2. **Google Directions API** — only called when no cached row is found.
 *      Falls back gracefully to `null` if the key is missing or the API errors.
 *
 * ### Why this matters
 * Repeating patients (e.g. dialysis 3×/week, school transport daily) travel the
 * same route many times per month. The cache ensures only the **first** occurrence
 * ever costs a Google API call; all subsequent trips on that route are resolved
 * from the database.
 *
 * ### Duplication note
 * When duplicating a trip that already has metrics, `duplicate-trips.ts` copies
 * `driving_distance_km` and `driving_duration_seconds` directly from the source row
 * via `copyRouteAndPassengerFields` — this function is **not called at all** in that
 * happy path. It only runs as a fallback via `enrichInsertWithMetrics` when the
 * source trip has coordinates but null metrics (legacy data).
 *
 * ### Bulk-upload note
 * During CSV import, geocoding and metrics resolution run in `Promise.all` (parallel).
 * For a brand-new route with no prior trips, concurrent requests for the same coordinates
 * will all miss the DB cache and hit Google simultaneously. After the first batch is
 * inserted, all future imports of that route are served from the cache.
 */
export async function resolveDrivingMetricsWithCache(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  supabase: SupabaseClient<Database>
): Promise<ResolvingMetrics | null> {
  // ── Tier 1: DB cache ────────────────────────────────────────────────────
  // Look for any existing trip with matching endpoints and populated metrics.
  // Using exact float equality is intentional: coordinates are always stored
  // as-returned by the geocoder so the same address always yields the same value.
  const { data, error } = await supabase
    .from('trips')
    .select('driving_distance_km, driving_duration_seconds')
    .eq('pickup_lat', originLat)
    .eq('pickup_lng', originLng)
    .eq('dropoff_lat', destLat)
    .eq('dropoff_lng', destLng)
    .not('driving_distance_km', 'is', null)
    .not('driving_duration_seconds', 'is', null)
    .limit(1)
    .maybeSingle();

  if (
    !error &&
    data &&
    data.driving_distance_km !== null &&
    data.driving_duration_seconds !== null
  ) {
    return {
      distanceKm: data.driving_distance_km,
      durationSeconds: data.driving_duration_seconds,
      source: 'cache'
    };
  }

  // ── Tier 2: Google Directions ────────────────────────────────────────────
  const metrics = await getDrivingMetrics(
    originLat,
    originLng,
    destLat,
    destLng
  );
  if (!metrics) return null;

  return {
    ...metrics,
    source: 'google'
  };
}
