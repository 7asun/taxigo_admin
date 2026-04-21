/**
 * Google Maps Directions API (server-side only).
 *
 * Exports two functions:
 *   - `getDrivingMetrics`            — raw Google Directions call, use only when you explicitly
 *                                       want to bypass the cache (e.g. forced refresh).
 *   - `resolveDrivingMetricsWithCache` — preferred entry point for all callers. Checks
 *                                       `route_metrics_cache` for a row with matching
 *                                       coordinates (rounded to COORD_PRECISION decimal places)
 *                                       before hitting Google, then writes the result back
 *                                       immediately so concurrent callers on the same route
 *                                       find it in the DB.
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

/**
 * Coordinates are rounded to this many decimal places before cache lookup and write-back.
 * 5 dp ≈ 1 m precision — tight enough to be accurate, loose enough to survive geocoder
 * non-determinism across code paths (e.g. cron vs form vs bulk upload) that can produce
 * the same address with slightly different trailing digits.
 *
 * Every caller that builds cache keys must import and use this constant — never hardcode 5.
 */
export const COORD_PRECISION = 5;

/**
 * Round a coordinate to COORD_PRECISION decimal places.
 * Using parseFloat(toFixed()) avoids storing trailing-zero strings as numbers
 * (e.g. 53.10000 → 53.1) while keeping numeric identity stable.
 */
function roundCoord(value: number): number {
  return parseFloat(value.toFixed(COORD_PRECISION));
}

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
 * Resolves driving distance and duration for a route using a two-tier lookup:
 *
 *   1. **`route_metrics_cache` (DB cache)** — queries a dedicated cache table keyed
 *      on coordinates rounded to COORD_PRECISION decimal places. If a matching row
 *      exists, returns those values immediately without touching Google.
 *
 *   2. **Google Directions API** — called only when no cached row is found. After a
 *      successful response the result is written back to `route_metrics_cache`
 *      immediately — before returning to the caller — so any concurrent request for
 *      the same route (e.g. N rows in a bulk upload all missing the cache) will find
 *      the result on their own DB lookup within the same upload batch. The upsert
 *      uses `ignoreDuplicates: true` so a second concurrent write on the same unique
 *      key is silently dropped by the DB constraint rather than erroring.
 *
 * ### Why coordinates are rounded before lookup
 * The same address geocoded through different code paths (cron vs. form vs. bulk
 * upload) or on different dates can produce coordinates that differ at the last
 * decimal place. Exact float equality on raw geocoder output would cause a cache
 * miss for every such variation even though the route is identical in practice.
 * Rounding to 5 dp (~1 m) absorbs this noise while remaining accurate enough for
 * driving-distance purposes.
 *
 * ### Why `companyId` is required
 * The cache is scoped per company so that one company's routes never pollute
 * another company's cache. Global sharing across companies is deferred.
 *
 * ### Duplication note
 * When duplicating a trip that already has metrics, `duplicate-trips.ts` copies
 * `driving_distance_km` and `driving_duration_seconds` directly from the source row
 * via `copyRouteAndPassengerFields` — this function is **not called at all** in that
 * happy path. It only runs as a fallback via `enrichInsertWithMetrics` when the
 * source trip has null metrics (legacy data).
 */
export async function resolveDrivingMetricsWithCache(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  supabase: SupabaseClient<Database>,
  companyId: string
): Promise<ResolvingMetrics | null> {
  // Round before any lookup so the cache key is stable across geocoder variations.
  const rOriginLat = roundCoord(originLat);
  const rOriginLng = roundCoord(originLng);
  const rDestLat = roundCoord(destLat);
  const rDestLng = roundCoord(destLng);

  // ── Tier 1: route_metrics_cache ──────────────────────────────────────────
  const { data, error } = await supabase
    .from('route_metrics_cache')
    .select('distance_km, duration_seconds')
    .eq('company_id', companyId)
    .eq('origin_lat', rOriginLat)
    .eq('origin_lng', rOriginLng)
    .eq('dest_lat', rDestLat)
    .eq('dest_lng', rDestLng)
    .maybeSingle();

  if (!error && data) {
    return {
      distanceKm: data.distance_km,
      durationSeconds: data.duration_seconds,
      source: 'cache'
    };
  }

  // ── Tier 2: Google Directions ────────────────────────────────────────────
  // Call with original (un-rounded) coordinates for maximum precision in the result.
  const metrics = await getDrivingMetrics(
    originLat,
    originLng,
    destLat,
    destLng
  );
  if (!metrics) return null;

  // Write back to cache immediately so concurrent requests on the same route
  // (e.g. multiple CSV rows for the same dialysis clinic) find this result on
  // their own DB lookup. ignoreDuplicates means a racing second write is silently
  // dropped by the unique constraint rather than returning an error.
  const { error: upsertError } = await supabase
    .from('route_metrics_cache')
    .upsert(
      {
        company_id: companyId,
        origin_lat: rOriginLat,
        origin_lng: rOriginLng,
        dest_lat: rDestLat,
        dest_lng: rDestLng,
        distance_km: metrics.distanceKm,
        duration_seconds: metrics.durationSeconds
      },
      {
        onConflict: 'company_id,origin_lat,origin_lng,dest_lat,dest_lng',
        ignoreDuplicates: true
      }
    );

  if (upsertError) {
    // Log but never throw — the caller still gets the metrics even if persistence fails.
    console.error(
      '[resolveDrivingMetricsWithCache] cache write-back failed',
      upsertError
    );
  }

  return {
    ...metrics,
    source: 'google'
  };
}
